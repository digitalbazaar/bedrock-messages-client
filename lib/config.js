/*
 * Copyright (c) 2016 Digital Bazaar, Inc. All rights reserved.
 */

var config = require('bedrock').config;
var path = require('path');

config['messages-client'] = config['messages-client'] || {};
config['messages-client'].clients = config['messages-client'].clients || [];
config['messages-client'].maxMessageRetrievalRetries =
  config['messages-client'].maxMessageRetrievalRetries || 3;
