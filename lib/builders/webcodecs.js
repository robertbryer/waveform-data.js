"use strict";

var getAudioDecoder = require("./audiodecoder");
var InlineWorker = require("inline-worker");
var MainThreadWorker = require("../util/main-thread-worker");

//find a proper mp4box lib / npm i and put into build correctly
//parse metadata properly
//move the fetch outside
//stream data from the fetch into mp4box

function setupWorker(url, options, callback, progressCallback) {
    var WaveformWorker = options.disable_worker ? MainThreadWorker : InlineWorker;
    var worker = new WaveformWorker(function() {
        var MP4Box = this.exports = {};//find a umd!

        //this needs to be fully qualified because relative urls are relative to the blob
        //construct outside with document url and pass in.
        importScripts('http://smp-scratch.tools.bbc.co.uk/bob/waveform/mp4box.all.js');
        //importScripts('http://bob.bbc.co.uk/waveform/mp4box.all.js');
        var mp4boxfile;
        function setupDemux(url, infoCallback, sampleCallback) {
            mp4boxfile = MP4Box.createFile();
            mp4boxfile.onError = onError;
            mp4boxfile.onReady = onReady.bind(null, infoCallback);
            mp4boxfile.onSamples = onSamples.bind(null, sampleCallback);

            return fetch(url).then(function(response) {
                return response.arrayBuffer();
            }).then(function (arrayBuffer) {
                //const stream = response.body;
                arrayBuffer.fileStart = 0;
                mp4boxfile.appendBuffer(arrayBuffer);
                mp4boxfile.flush();
            });
        }

        function onReady(callback, info) {
            console.log(info);
            var track = info.tracks[0];
            callback(info, track);
            mp4boxfile.setExtractionOptions(track.id, "user");
            mp4boxfile.start();
        }

        function onError(error) {
            console.error(error);
        }

        function onSamples(callback, id, user, samples) {
            callback(samples);
        }

        var ad;
        function setupDecoder(codec) {
            ad = new AudioDecoder({
                output: decoderOutput,
                error: errorFn
            });

            ad.configure({
                codec: codec,
                numberOfChannels: 2,
                sampleRate: 44100
            });
        }

        var sampleLength;
        var buffer;
        var offset;
        var codec;
        var sampleRate;

        function onInfo(info, track) {
            sampleLength = track.samples_duration;
            sampleRate = track.audio.sample_rate;
            codec = track.codec;
            var aac = codec.indexOf("40.2") >= 0;

            setupDecoder(track.codec);
            buffer = new Float32Array(sampleLength);
            offset = 0;
            track = track;
        }

        var frames = 0;
        function decoderOutput(frame) {
            var sampleStart = 0;
            frames++;
            if (frames < 3) {
                console.log(frame);
                //https://developer.apple.com/library/archive/documentation/QuickTime/QTFF/QTFFAppenG/QTFFAppenG.html
                //This is still off 2112 – mp4box doing this, but not the after samples?
                //sampleStart = arr.length === 2 ? 64 : 1024
            }

            var overflow = (offset + frame.buffer.length) - sampleLength;

            if (sampleStart < frame.buffer.length) {
                var bufferLength = overflow <= 0 ? frame.buffer.length : frame.buffer.length - overflow;
                frame.buffer.copyFromChannel(buffer.subarray(offset, offset + bufferLength), 0, 0);
            }
            offset += frame.buffer.length - sampleStart;

            frame.close();

            //maybe don't do this every single frame
            webworker.postMessage({ type: "progress", sample: offset, length: sampleLength });

            if (offset > sampleLength) { //theres overflow off the end for aac.
                var audio_buffer_obj = {
                    length: sampleLength,
                    sampleRate: sampleRate,
                    channels: [buffer]
                };
                webworker.postMessage({ type: "finished", buffer: audio_buffer_obj });
                webworker.close();
            }
        }

        function errorFn(e) {
            console.error(e);
        }

        function decode(samples) {
            for (var i = 0; i < samples.length; i++) {
                const chunk = new EncodedAudioChunk({
                    type: samples[i].is_sync ? "key" : "delta",
                    timestamp: samples[i].cts,
                    data: samples[i].data
                });
                ad.decode(chunk);
            }
        }
        var webworker = this;
        this.addEventListener("message", function(msg) {
            console.log(msg);
            setupDemux(msg.data.url, onInfo, decode);
        });
    });
    
    worker.addEventListener("message", function listener(evt) {
        if (evt.data.type === "finished") {
            var audio_buffer_obj = evt.data.buffer;
            getAudioDecoder(options, callback)(audio_buffer_obj, true);

            worker.removeEventListener("message", listener);
        } else if (evt.data.type === "progress") {
            progressCallback(evt.data.sample, evt.data.length);
        }
    });

    worker.postMessage({url : url});
}

function createFromWebCodecs(url, opt, cb, progress) {
    setupWorker(url, opt, cb, progress);
}

module.exports = createFromWebCodecs; 
