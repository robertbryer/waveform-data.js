"use strict";

var WaveformData = require("./lib/core");

WaveformData.createFromAudio = require("./lib/builders/webaudio");
WaveformData.createFromWebCodecs = require("./lib/builders/webcodecs");

module.exports = WaveformData;
