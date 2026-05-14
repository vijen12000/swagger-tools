/* global describe, it */

'use strict';

process.env.NODE_ENV = 'test';
process.env.RUNNING_SWAGGER_TOOLS_TESTS = 'true';

var _ = require('lodash');
var assert = require('assert');
var request = require('supertest');
var helpers = require('../helpers');

var createBaseDoc = function () {
  return {
    openapi: '3.1.0',
    info: {
      title: 'OAS3 matrix tests',
      version: '1.0.0'
    },
    servers: [
      {
        url: '/v1'
      }
    ],
    paths: {}
  };
};

describe('OpenAPI 3.x Compatibility Matrix', function () {
  it('supports servers url -> basePath routing', function (done) {
    var doc = createBaseDoc();

    doc.paths['/ping'] = {
      get: {
        operationId: 'ping',
        responses: {
          '200': {
            description: 'pong',
            content: {
              'application/json': {
                schema: {
                  type: 'object'
                }
              }
            }
          }
        }
      }
    };

    helpers.createServer([doc], {
      swaggerRouterOptions: {
        controllers: {
          ping: function (req, res) {
            res.end('pong');
          }
        }
      }
    }, function (app) {
      request(app)
        .get('/v1/ping')
        .expect(200)
        .end(helpers.expectContent('pong', done));
    });
  });

  it('supports requestBody $ref conversion and validation', function (done) {
    var doc = createBaseDoc();

    doc.components = {
      requestBodies: {
        ProfileBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['name'],
                properties: {
                  name: {
                    type: 'string'
                  }
                }
              }
            }
          }
        }
      }
    };

    doc.paths['/profiles'] = {
      post: {
        operationId: 'createProfile',
        requestBody: {
          $ref: '#/components/requestBodies/ProfileBody'
        },
        responses: {
          '200': {
            description: 'created'
          }
        }
      }
    };

    helpers.createServer([doc], {
      swaggerRouterOptions: {
        controllers: {
          createProfile: function (req, res) {
            res.end('OK');
          }
        }
      }
    }, function (app) {
      request(app)
        .post('/v1/profiles')
        .send({})
        .expect(400)
        .end(done);
    });
  });

  it('supports http bearer security scheme conversion', function (done) {
    var doc = createBaseDoc();
    var called = false;

    doc.components = {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer'
        }
      }
    };

    doc.paths['/secure'] = {
      get: {
        operationId: 'getSecure',
        security: [{ bearerAuth: [] }],
        responses: {
          '200': {
            description: 'ok'
          }
        }
      }
    };

    helpers.createServer([doc], {
      swaggerRouterOptions: {
        controllers: {
          getSecure: function (req, res) {
            res.end('secure');
          }
        }
      },
      swaggerSecurityOptions: {
        bearerAuth: function (req, secDef, token, cb) {
          called = true;
          if (token === 'Bearer good-token') {
            return cb();
          }

          return cb(new Error('Unauthorized'));
        }
      }
    }, function (app) {
      request(app)
        .get('/v1/secure')
        .set('Authorization', 'Bearer good-token')
        .expect(200)
        .end(function (err) {
          if (err) {
            return done(err);
          }

          assert.strictEqual(called, true);

          return done();
        });
    });
  });

  it('supports cookie parameters (failing-first)', function (done) {
    var doc = createBaseDoc();

    doc.paths['/session'] = {
      get: {
        operationId: 'getSession',
        parameters: [
          {
            name: 'sid',
            in: 'cookie',
            required: true,
            schema: {
              type: 'string'
            }
          }
        ],
        responses: {
          '200': {
            description: 'ok'
          }
        }
      }
    };

    helpers.createServer([doc], {
      swaggerRouterOptions: {
        controllers: {
          getSession: function (req, res) {
            assert.strictEqual(req.swagger.params.sid.value, 'abc123');
            res.end('cookie-ok');
          }
        }
      }
    }, function (app) {
      request(app)
        .get('/v1/session')
        .set('Cookie', ['sid=abc123'])
        .expect(200)
        .end(done);
    });
  });

  it('supports nullable schemas (failing-first)', function (done) {
    var doc = createBaseDoc();

    doc.paths['/nicknames'] = {
      post: {
        operationId: 'saveNickname',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['nickname'],
                properties: {
                  nickname: {
                    type: 'string',
                    nullable: true
                  }
                }
              }
            }
          }
        },
        responses: {
          '200': {
            description: 'ok'
          }
        }
      }
    };

    helpers.createServer([doc], {
      swaggerRouterOptions: {
        controllers: {
          saveNickname: function (req, res) {
            assert.strictEqual(req.body.nickname, null);
            res.end('nullable-ok');
          }
        }
      }
    }, function (app) {
      request(app)
        .post('/v1/nicknames')
        .send({ nickname: null })
        .expect(200)
        .end(done);
    });
  });
});
