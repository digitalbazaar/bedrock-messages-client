/*
 * Copyright (c) 2016 Digital Bazaar, Inc. All rights reserved.
 */

var config = require('bedrock').config;
var mockData = require('./mocha/mock.data');
var path = require('path');
var url = require('url');

config.mocha.tests.push(path.join(__dirname, 'mocha'));

// MongoDB
config.mongodb.name = 'bedrock_messages_client_test';
config.mongodb.local.collection = 'bedrock_messages_client_test';
config.mongodb.dropCollections.onInit = true;
config.mongodb.dropCollections.collections = [];

// messages-client
var messageEndpoint = url.format({
  protocol: 'https',
  hostname: 'alpha.example.com',
  port: '443',
  pathname: 'messages',
  query: {
    recipient: mockData.recipientId,
    state: 'new'
  }
});
config['messages-client'].enable = true;
config['messages-client'].clients.push({
  id: 'message.test',
  label: 'Message Test',
  endpoint: messageEndpoint,
  interval: 10, // Interval to poll in minutes
  publicKeyId: mockData.identities.rsa4096.keys.publicKey.id,
  strictSSL: false
});
config['messages-client'].maxMessageRetrievalRetries = 3;
