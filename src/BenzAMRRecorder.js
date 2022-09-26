/**
 * @file AMR 录音、转换、播放器
 * @author BenzLeung(https://github.com/BenzLeung)
 * @date 2017/11/12
 * Created by JetBrains PhpStorm.
 *
 * 每位工程师都有保持代码优雅的义务
 * each engineer has a duty to keep the code elegant
 */

import RecorderControl from "./RecorderControl";
import amrWorker from "./amrnb";

const amrWorkerStr = amrWorker.toString()
    .replace(/^\s*function.*?\(\)\s*{/, '')
    .replace(/}\s*$/, '');
const amrWorkerURLObj = (window.URL || window.webkitURL).createObjectURL(new Blob([amrWorkerStr], {type:"text/javascript"}));

import amrWbWorker from "./amrwb";
const amrWbWorkerStr = amrWbWorker.toString()
    .replace(/^\s*function.*?\(\)\s*{/, '')
    .replace(/}\s*$/, '');
const amrWbWorkerURLObj = (window.URL || window.webkitURL).createObjectURL(new Blob([amrWbWorkerStr], {type:"text/javascript"}));

export default class BenzAMRRecorder {

    _isInit = false;

    _isInitRecorder = false;

    _recorderControl = new RecorderControl();

    _samples = new Float32Array(0);

    _rawData = new Uint8Array(0);

    _blob = null;

    _onEnded = null;

    _onAutoEnded = null;

    _onPlay = null;

    _onPause = null;

    _onResume = null;

    _onStop = null;

    _onStartRecord = null;

    _onCancelRecord = null;

    _onFinishRecord = null;

    _isPlaying = false;

    _isPaused = false;

    _startCtxTime = 0.0;

    _pauseTime = 0.0;

    _wbAudioType = '';
    
    constructor() {
    }

    /**
     * 是否已经初始化
     * @return {boolean}
     */
    isInit() {
        return this._isInit;
    }

    /**
     * 使用浮点数据初始化
     * @param {Float32Array} array
     * @return {Promise}
     */
    initWithArrayBuffer(array) {
        this._wbAudioType = this.getAudioType(array);
        if (this._isInit || this._isInitRecorder) {
            BenzAMRRecorder.throwAlreadyInitialized();
        }
        this._playEmpty();
        return new Promise((resolve, reject) => {
            if(this._wbAudioType === 'audio/amr-wb') {
                let u8Array = new Uint8Array(array);
                this.decodeAMRWBAsync(u8Array).then((samples) => {
                    this._samples = samples;
                    this._isInit = true;
    
                    if (!this._samples) {
                        RecorderControl.decodeAudioArrayBufferByContext(array).then((data) => {
                            this._isInit = true;
                            return this.encodeAMRAsync(data, RecorderControl.getCtxSampleRate());
                        }).then((rawData) => {
                            this._rawData = rawData;
                            this._blob = BenzAMRRecorder.rawAMRWBData2Blob(rawData);
                            return this.decodeAMRWBAsync(rawData);
                        }).then((sample) => {
                            this._samples = sample;
                            resolve();
                        }).catch(() => {
                            reject(new Error('Failed to decode.'));
                        });
                    } else {
                        this._rawData = u8Array;
                        resolve();
                    }
                });
            }else {
                let u8Array = new Uint8Array(array);
                this.decodeAMRAsync(u8Array).then((samples) => {
                    this._samples = samples;
                    this._isInit = true;
    
                    if (!this._samples) {
                        RecorderControl.decodeAudioArrayBufferByContext(array).then((data) => {
                            this._isInit = true;
                            return this.encodeAMRAsync(data, RecorderControl.getCtxSampleRate());
                        }).then((rawData) => {
                            this._rawData = rawData;
                            this._blob = BenzAMRRecorder.rawAMRData2Blob(rawData);
                            return this.decodeAMRAsync(rawData);
                        }).then((sample) => {
                            this._samples = sample;
                            resolve();
                        }).catch(() => {
                            reject(new Error('Failed to decode.'));
                        });
                    } else {
                        this._rawData = u8Array;
                        resolve();
                    }
                });
            }
        });
    }

    /**
     * 使用 Blob 对象初始化（ <input type="file">）
     * @param {Blob} blob
     * @return {Promise}
     */
    initWithBlob(blob) {
        if (this._isInit || this._isInitRecorder) {
            BenzAMRRecorder.throwAlreadyInitialized();
        }
        this._playEmpty();
        this._blob = blob;
        const p = new Promise((resolve) => {
            let reader = new FileReader();
            reader.onload = function(e) {
                resolve(e.target.result);
            };
            reader.readAsArrayBuffer(blob);
        });
        return p.then((data) => {
            return this.initWithArrayBuffer(data);
        });
    }

    /**
     * 使用 url 初始化
     * @param {string} url
     * @return {Promise}
     */
    initWithUrl(url) {
        if (this._isInit || this._isInitRecorder) {
            BenzAMRRecorder.throwAlreadyInitialized();
        }
        this._playEmpty();
        const p = new Promise((resolve, reject) => {
            let xhr = new XMLHttpRequest();
            xhr.open('GET', url, true);
            xhr.responseType = 'arraybuffer';
            xhr.onload = function() {
                resolve(this.response);
            };
            xhr.onerror = function() {
                reject(new Error('Failed to fetch ' + url));
            };
            xhr.send();
        });
        return p.then((array) => {
            return this.initWithArrayBuffer(array);
        });
    }

    /**
     * 初始化录音
     * @return {Promise}
     */
    initWithRecord() {
        if (this._isInit || this._isInitRecorder) {
            BenzAMRRecorder.throwAlreadyInitialized();
        }
        this._playEmpty();
        return new Promise((resolve, reject) => {
            this._recorderControl.initRecorder().then(() => {
                this._isInitRecorder = true;
                resolve();
            }).catch((e) => {
                reject(e);
            });
        });
    }

    /**
     * 根据文件头判断文件类型
     * @param {Float32Array} array 
     */
    getAudioType(array) {
        let headerArray = new Int8Array(array.slice(0, 8));
        let header = String.fromCharCode(...headerArray);
        
        if(header === '#!AMR-WB') {
            return 'audio/amr-wb';
        }

        if(header.includes('AMR')) {
            return 'audio/amr';
        }

        return 'audio/other'
    };

    /**
     * init 之前先播放一个空音频。
     * 因为有些环境（如iOS）播放首个音频时禁止自动、异步播放，
     * 播放空音频防止加载后立即播放的功能失效。
     * 但即使如此，init* 仍然须放入一个用户事件中
     * @private
     */
    _playEmpty = () => {
        this._recorderControl.playPcm(new Float32Array(10), 24000);
    };

    on(action, fn) {
        if (typeof fn === 'function') {
            switch (action) {
                case 'play':
                    this._onPlay = fn;
                    break;
                case 'stop':
                    this._onStop = fn;
                    break;
                case 'pause':
                    this._onPause = fn;
                    break;
                case 'resume':
                    this._onResume = fn;
                    break;
                case 'ended':
                    this._onEnded = fn;
                    break;
                case 'autoEnded':
                    this._onAutoEnded = fn;
                    break;
                case 'startRecord':
                    this._onStartRecord = fn;
                    break;
                case 'cancelRecord':
                    this._onCancelRecord = fn;
                    break;
                case 'finishRecord':
                    this._onFinishRecord = fn;
                    break;
                default:
            }
        }
    }

    /**
     * 播放事件
     * @param {Function} fn
     */
    onPlay(fn) {
        this.on('play', fn);
    }

    /**
     * 停止事件（包括播放结束）
     * @param {Function} fn
     */
    onStop(fn) {
        this.on('stop', fn);
    }

    /**
     * 暂停事件
     * @param {Function} fn
     */
    onPause(fn) {
        this.on('pause', fn);
    }

    /**
     * 继续播放事件
     * @param {Function} fn
     */
    onResume(fn) {
        this.on('resume', fn);
    }

    /**
     * 播放结束事件
     * @param {Function} fn
     */
    onEnded(fn) {
        this.on('ended', fn);
    }

    /**
     * 播放完毕自动结束事件
     * @param {Function} fn
     */
    onAutoEnded(fn) {
        this.on('autoEnded', fn);
    }

    /**
     * 开始录音事件
     * @param {Function} fn
     */
    onStartRecord(fn) {
        this.on('startRecord', fn);
    }

    /**
     * 结束录音事件
     * @param {Function} fn
     */
    onFinishRecord(fn) {
        this.on('finishRecord', fn);
    }

    /**
     * 放弃录音事件
     * @param {Function} fn
     */
    onCancelRecord(fn) {
        this.on('cancelRecord', fn);
    }

    _onEndCallback = () => {
        if (this._isPlaying) {
            this._isPlaying = false;
            if (this._onStop) {
                this._onStop();
            }
            if (this._onAutoEnded) {
                this._onAutoEnded();
            }
        }
        if (!this._isPaused) {
            if (this._onEnded) {
                this._onEnded();
            }
        }
    };

    /**
     * 播放（重新开始，无视暂停状态）
     * @param {number|string?} startTime 可指定开始位置
     */
    play(startTime) {
        const _startTime = (startTime && startTime < this.getDuration()) ? parseFloat(startTime) : 0;
        if (!this._isInit) {
            throw new Error('Please init AMR first.');
        }
        if (this._onPlay) {
            this._onPlay();
        }
        this._isPlaying = true;
        this._isPaused = false;
        this._startCtxTime = RecorderControl.getCtxTime() - _startTime;
        this._recorderControl.playPcm(
            this._samples,
            this._isInitRecorder ? RecorderControl.getCtxSampleRate() : 8000,
            this._onEndCallback.bind(this),
            _startTime,
            this._wbAudioType
        );
    }

    /**
     * 停止
     */
    stop() {
        this._recorderControl.stopPcm();
        this._isPlaying = false;
        this._isPaused = false;
        if (this._onStop) {
            this._onStop();
        }
    }

    /**
     * 暂停
     */
    pause() {
        if (!this._isPlaying) {
            return;
        }
        this._isPlaying = false;
        this._isPaused = true;
        this._pauseTime = RecorderControl.getCtxTime() - this._startCtxTime;
        this._recorderControl.stopPcm();
        if (this._onPause) {
            this._onPause();
        }
    }

    /**
     * 从暂停处继续
     */
    resume() {
        if (!this._isPaused) {
            return;
        }
        this._isPlaying = true;
        this._isPaused = false;
        this._startCtxTime = RecorderControl.getCtxTime() - this._pauseTime;
        this._recorderControl.playPcm(
            this._samples,
            this._isInitRecorder ? RecorderControl.getCtxSampleRate() : 8000,
            this._onEndCallback.bind(this),
            this._pauseTime,
            this._wbAudioType
        );
        if (this._onResume) {
            this._onResume();
        }
    }

    /**
     * 整合 play() 和 resume()，若在暂停状态则继续，否则从头播放
     */
    playOrResume() {
        if (this._isPaused) {
            this.resume();
        } else {
            this.play();
        }
    }

    /**
     * 整合 resume() 和 pause()
     */
    pauseOrResume() {
        if (this._isPaused) {
            this.resume();
        } else {
            this.pause();
        }
    }

    /**
     * 整合 play() 和 resume() 和 pause()
     */
    playOrPauseOrResume() {
        if (this._isPaused) {
            this.resume();
        } else if (this._isPlaying) {
            this.pause();
        } else {
            this.play();
        }
    }

    /**
     * 跳转到音频指定位置，不改变播放状态
     * @param {number|string} time 指定位置（秒，浮点数）
     */
    setPosition(time) {
        const _time = parseFloat(time);
        if (_time > this.getDuration()) {
            this.stop();
        } else if (this._isPaused) {
            this._pauseTime = _time;
        } else if (this._isPlaying) {
            this._recorderControl.stopPcmSilently();
            this._startCtxTime = RecorderControl.getCtxTime() - _time;
            this._recorderControl.playPcm(
                this._samples,
                this._isInitRecorder ? RecorderControl.getCtxSampleRate() : 8000,
                this._onEndCallback.bind(this),
                _time,
                this._wbAudioType
            );
        } else {
            this.play(_time);
        }
    }

    /**
     * 获取当前播放位置（秒）
     * @return {Number} 位置，秒，浮点数
     */
    getCurrentPosition() {
        if (this._isPaused) {
            return this._pauseTime;
        } else if (this._isPlaying) {
            return RecorderControl.getCtxTime() - this._startCtxTime;
        }
        return 0;
    }

    /**
     * 是否正在播放
     * @return {boolean}
     */
    isPlaying() {
        return this._isPlaying;
    }

    /**
     * 是否暂停中
     * @return {boolean}
     */
    isPaused() {
        return this._isPaused;
    }

    /**
     * 开始录音
     */
    startRecord() {
        this._recorderControl.startRecord();
        if (this._onStartRecord) {
            this._onStartRecord();
        }
    }

    /**
     * 结束录音，并把录制的音频转换成 AMR
     * @return {Promise}
     */
    finishRecord() {
        return new Promise((resolve) => {
            this._recorderControl.stopRecord();
            this._recorderControl.generateRecordSamples().then((samples) => {
                this._samples = samples;
                return this.encodeAMRAsync(samples, RecorderControl.getCtxSampleRate());
            }).then((rawData) => {
                this._rawData = rawData;
                this._blob = BenzAMRRecorder.rawAMRData2Blob(this._rawData);
                this._isInit = true;
                if (this._onFinishRecord) {
                    this._onFinishRecord();
                }
                this._recorderControl.releaseRecord();
                resolve();
            });
        });
    }

    /**
     * 放弃录音
     */
    cancelRecord() {
        this._recorderControl.stopRecord();
        this._recorderControl.releaseRecord();
        if (this._onCancelRecord) {
            this._onCancelRecord();
        }
    }

    /**
     * 是否正在录音
     * @return {boolean}
     */
    isRecording() {
        return this._recorderControl.isRecording();
    }

    /**
     * 获取音频的时间长度（单位：秒）
     * @return {number}
     */
    getDuration() {
        let rate = this._isInitRecorder ? RecorderControl.getCtxSampleRate() : (this._wbAudioType === 'audio/amr-wb' ? 16000 : 8000);
        return this._samples.length / rate;
    }

    getBlob() {
        return this._blob;
    }

    /*
    static encodeAMR(samples, sampleRate) {
        sampleRate = sampleRate || 8000;
        return AMR.encode(samples, sampleRate, 7);
    }
    */

    _runAMRWorker = (msg, resolve) => {
        const amrWorker = new Worker(amrWorkerURLObj);
        amrWorker.postMessage(msg);
        amrWorker.onmessage = (e) => {
            resolve(e.data.amr);
            amrWorker.terminate();
        };
    };

    encodeAMRAsync(samples, sampleRate) {
        return new Promise(resolve => {
            this._runAMRWorker({
                command: 'encode',
                samples: samples,
                sampleRate: sampleRate
            }, resolve);
        });
    }
    
    decodeAMRAsync(u8Array) {
        return new Promise(resolve => {
            this._runAMRWorker({
                command: 'decode',
                buffer: u8Array
            }, resolve);
        })
    }

    // amr-wb
    _runAMRWBWorker = (msg, resolve) => {
        const amrWbWorker = new Worker(amrWbWorkerURLObj);
        amrWbWorker.postMessage(msg);
        amrWbWorker.onmessage = (e) => {
            resolve(e.data.amr);
            amrWbWorker.terminate();
        };
    };

    // amr-wb 编码
    encodeAMRWBAsync(samples, sampleRate) {
        return new Promise(resolve => {
            this._runAMRWBWorker({
                command: 'encode',
                samples: samples,
                sampleRate: sampleRate
            }, resolve);
        });
    }

    decodeAMRWBAsync(u8Array) {
        return new Promise(resolve => {
            this._runAMRWBWorker({
                command: 'decode',
                buffer: u8Array
            }, resolve);
        })
    }

    static rawAMRWBData2Blob(data) {
        return new Blob([data.buffer], {type: 'audio/amr-wb'});
    }

    static rawAMRData2Blob(data) {
        return new Blob([data.buffer], {type: 'audio/amr'});
    }

    static throwAlreadyInitialized() {
        throw new Error('AMR has been initialized. For a new AMR, please generate a new BenzAMRRecorder().');
    }

    /**
     * 判断浏览器是否支持播放
     * @return {boolean}
     */
    static isPlaySupported() {
        return RecorderControl.isPlaySupported();
    }

    /**
     * 判断浏览器是否支持录音
     * @return {boolean}
     */
    static isRecordSupported() {
        return RecorderControl.isRecordSupported();
    }
}
