/* global describe, it */

'use strict';

process.env.NODE_ENV = 'test';
process.env.RUNNING_SWAGGER_TOOLS_TESTS = 'true';

var assert = require('assert');
var request = require('supertest');
var helpers = require('../helpers');

var openapi3Doc = {
  openapi: '3.1.0',
  info: {
    title: 'OpenAPI 3 test API',
    version: '1.0.0'
  },
  servers: [
    {
      url: '/api'
    }
  ],
  paths: {
    '/greeting': {
      get: {
        operationId: 'getGreeting',
        parameters: [
          {
            name: 'limit',
            in: 'query',
            schema: {
              type: 'integer'
            }
          }
        ],
        responses: {
          '200': {
            description: 'Success',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    message: {
                      type: 'string'
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    '/users/{id}': {
      get: {
        operationId: 'getUser',
        parameters: [
          {
            name: 'id',
            in: 'path',
            required: true,
            schema: {
              type: 'integer'
            }
          }
        ],
        responses: {
          '200': {
            description: 'Success',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    id: {
                      type: 'integer'
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  }
};

describe('OpenAPI 3.x Compatibility', function () {
  it('should initialize and route requests for OpenAPI 3.x documents', function (done) {
    helpers.createServer([openapi3Doc], {
      swaggerRouterOptions: {
        controllers: {
          getUser: function (req, res) {
            assert.ok(req.swagger);
            assert.strictEqual(req.swagger.swaggerVersion, '2.0');
            assert.strictEqual(req.swagger.params.id.value, 10);
            res.end('OK');
          }
        }
      }
    }, function (app) {
      request(app)
        .get('/api/users/10')
        .expect(200)
        .end(helpers.expectContent('OK', done));
    });
  });

  it('should validate OpenAPI 3.x query parameters', function (done) {
    helpers.createServer([openapi3Doc], {
      swaggerRouterOptions: {
        controllers: {
          getGreeting: function (req, res) {
            res.end('OK');
          }
        }
      }
    }, function (app) {
      request(app)
        .get('/api/greeting')
        .query({ limit: 'not-a-number' })
        .expect(400)
        .end(done);
    });
  });
});
