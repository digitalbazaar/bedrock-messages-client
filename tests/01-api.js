/*
 * Copyright (c) 2015 Digital Bazaar, Inc. All rights reserved.
 */
 /* globals describe, before, after, it, should, beforeEach, afterEach */
 /* jshint node: true */

'use strict';

var _ = require('lodash');
var async = require('async');
var bedrock = require('bedrock');
var brMessages = require('../lib/messages');
var config = bedrock.config;
var database = require('bedrock-mongodb');
var helpers = require('./helpers');
var sinon = require('sinon');
var uuid = require('node-uuid').v4;

describe('bedrock-messages-client API requests', function() {
  describe('pollMessagesServer Function', function() {
    it('should do something');
  });
});
