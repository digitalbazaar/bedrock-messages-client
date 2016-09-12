/*
 * Copyright (c) 2015 Digital Bazaar, Inc. All rights reserved.
 */
 /* jshint node: true */

'use strict';

var _ = require('lodash');
var async = require('async');
var brKey = require('bedrock-key');
var brIdentity = require('bedrock-identity');
var config = require('bedrock').config;
var uuid = require('uuid').v4;
var database = require('bedrock-mongodb');
var scheduler = require('bedrock-jobs');

var api = {};
module.exports = api;

api.createUrl = function(options) {
  var server = options.server;
  var id = options.id;
  var endpoint = options.endpoint;
  var newUrl = server.baseUrl + server.endpoints[endpoint] + '/' + id + '/new';
  return newUrl;
};

api.createJob = function() {
  var newJob = {};
  newJob.worker = {};
  newJob.worker.id = scheduler.createWorkerId();
  return newJob;
};

api.createMessages = function(recipient, count, messageType) {
  count = count || 1;
  var messages = [];
  for(var i = 0; i < count; i++) {
    messages.push(api.createMessage({
      recipient: recipient,
      messageType: messageType
    }));
  }
  return messages;
};

api.createMessage = function(options) {
  var testMessage = {
    body: uuid(),
    date: new Date().toJSON(),
    recipient: uuid(),
    sender: uuid(),
    subject: uuid()
  };
  _.assign(testMessage, options);
  var message = {
    '@context': 'https://example.com/messages',
    date: testMessage.date,
    recipient: testMessage.recipient,
    sender: testMessage.sender,
    subject: testMessage.subject,
    type: options.messageType || uuid(),
    content: {
      body: testMessage.body
    }
  };
  return message;
};

api.createIdentity = function(userName) {
  var newIdentity = {
    id: 'did:' + uuid.v4(),
    type: 'Identity',
    sysSlug: userName,
    label: userName,
    email: userName + '@bedrock.dev',
    sysPassword: 'password',
    sysPublic: ['label', 'url', 'description'],
    sysResourceRole: [],
    url: config.server.baseUri,
    description: userName
  };
  return newIdentity;
};

api.createKeyPair = function(options) {
  var publicKey = options.publicKey;
  var privateKey = options.privateKey;
  var ownerId = options.userId;
  var id = options.id || uuid();
  var keyId = config.server.baseUri + config.key.basePath + '/' + id;
  var newKeyPair = {
    publicKey: {
      '@context': 'https://w3id.org/identity/v1',
      id: keyId,
      type: 'CryptographicKey',
      owner: ownerId,
      label: 'Signing Key 1',
      publicKeyPem: publicKey
    },
    privateKey: {
      type: 'CryptographicKey',
      owner: ownerId,
      label: 'Signing Key 1',
      publicKey: keyId,
      privateKeyPem: privateKey
    }
  };
  return newKeyPair;
};

api.prepareDatabase = function(mockData, callback) {
  async.series([
    function(callback) {
      api.removeCollections(callback);
    },
    function(callback) {
      insertTestData(mockData, callback);
    }
  ], callback);
};

api.removeCollections = function(callback) {
  var collectionNames = ['messages', 'identity', 'publicKey', 'job',
    'messageClient'];
  database.openCollections(collectionNames, function() {
    async.each(collectionNames, function(collectionName, callback) {
      database.collections[collectionName].find({}, callback);
    }, function(err) {
      callback(err);
    });
  });
};

// Insert identities and public keys used for testing into database
function insertTestData(mockData, callback) {
  async.forEachOf(mockData.identities, function(identity, key, callback) {
    async.parallel([
      function(callback) {
        brIdentity.insert(null, identity.identity, callback);
      },
      function(callback) {
        brKey.addPublicKey(
          null, identity.keys.publicKey, identity.keys.privateKey, callback);
      }
    ], callback);
  }, function(err) {
    if(err) {
      if(!database.isDuplicateError(err)) {
        // duplicate error means test data is already loaded
        return callback(err);
      }
    }
    callback();
  }, callback);
}
