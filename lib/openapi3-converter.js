'use strict';

var _ = require('lodash');

var operationMethods = ['delete', 'get', 'head', 'options', 'patch', 'post', 'put'];

var rewriteRef = function (ref) {
  if (!_.isString(ref)) {
    return ref;
  }

  return ref
    .replace(/^#\/components\/schemas\//, '#/definitions/')
    .replace(/^#\/components\/parameters\//, '#/parameters/')
    .replace(/^#\/components\/responses\//, '#/responses/')
    .replace(/^#\/components\/securitySchemes\//, '#/securityDefinitions/');
};

var rewriteRefs = function (node) {
  if (_.isArray(node)) {
    return _.map(node, rewriteRefs);
  }

  if (_.isPlainObject(node)) {
    return _.reduce(node, function (acc, value, key) {
      if (key === '$ref') {
        acc[key] = rewriteRef(value);
      } else {
        acc[key] = rewriteRefs(value);
      }

      return acc;
    }, {});
  }

  return node;
};

var normalizeNullableSchemas = function (node) {
  if (_.isArray(node)) {
    return _.map(node, normalizeNullableSchemas);
  }

  if (!_.isPlainObject(node)) {
    return node;
  }

  var normalized = _.reduce(node, function (acc, value, key) {
    acc[key] = normalizeNullableSchemas(value);

    return acc;
  }, {});

  if (normalized.nullable === true) {
    if (_.isString(normalized.type)) {
      normalized.type = [normalized.type, 'null'];
    } else if (_.isArray(normalized.type) && normalized.type.indexOf('null') === -1) {
      normalized.type = normalized.type.concat(['null']);
    }

    normalized['x-nullable'] = true;
    delete normalized.nullable;
  }

  return normalized;
};

var pickMediaType = function (content) {
  if (!_.isPlainObject(content) || _.keys(content).length === 0) {
    return undefined;
  }

  if (content['application/json']) {
    return {
      mediaType: 'application/json',
      mediaObject: content['application/json']
    };
  }

  var firstMediaType = _.keys(content)[0];

  return {
    mediaType: firstMediaType,
    mediaObject: content[firstMediaType]
  };
};

var getServerDetails = function (servers) {
  var details = {
    basePath: '',
    schemes: []
  };
  var firstServer;

  if (!_.isArray(servers) || servers.length === 0) {
    return details;
  }

  firstServer = _.get(servers, '0.url');

  if (!_.isString(firstServer)) {
    return details;
  }

  // Replace templated values so URL parsing can work.
  firstServer = firstServer.replace(/\{[^}]+\}/g, 'value');

  try {
    var parsed = new URL(firstServer, 'http://localhost');
    var pathName = parsed.pathname || '';

    details.basePath = pathName === '/' ? '' : pathName;
    details.schemes = _.chain(servers)
      .map('url')
      .filter(_.isString)
      .map(function (serverUrl) {
        var normalized = serverUrl.replace(/\{[^}]+\}/g, 'value');
        var protocol = new URL(normalized, 'http://localhost').protocol;

        return protocol ? protocol.replace(':', '') : undefined;
      })
      .filter(function (scheme) {
        return scheme === 'http' || scheme === 'https';
      })
      .uniq()
      .value();
  } catch (err) {
    // Keep defaults when URL parsing fails.
  }

  return details;
};

var convertSecuritySchemes = function (securitySchemes) {
  return _.reduce(securitySchemes || {}, function (result, scheme, name) {
    var converted = rewriteRefs(_.cloneDeep(scheme));

    if (converted.type === 'http') {
      if (converted.scheme === 'basic') {
        converted.type = 'basic';
        delete converted.scheme;
      } else {
        converted.type = 'apiKey';
        converted.name = 'Authorization';
        converted.in = 'header';
        delete converted.scheme;
        delete converted.bearerFormat;
      }
    }

    if (converted.type === 'oauth2' && _.isPlainObject(converted.flows)) {
      if (converted.flows.implicit) {
        converted.flow = 'implicit';
        converted.authorizationUrl = converted.flows.implicit.authorizationUrl;
        converted.scopes = converted.flows.implicit.scopes;
      } else if (converted.flows.password) {
        converted.flow = 'password';
        converted.tokenUrl = converted.flows.password.tokenUrl;
        converted.scopes = converted.flows.password.scopes;
      } else if (converted.flows.clientCredentials) {
        converted.flow = 'application';
        converted.tokenUrl = converted.flows.clientCredentials.tokenUrl;
        converted.scopes = converted.flows.clientCredentials.scopes;
      } else if (converted.flows.authorizationCode) {
        converted.flow = 'accessCode';
        converted.authorizationUrl = converted.flows.authorizationCode.authorizationUrl;
        converted.tokenUrl = converted.flows.authorizationCode.tokenUrl;
        converted.scopes = converted.flows.authorizationCode.scopes;
      }

      delete converted.flows;
    }

    result[name] = converted;

    return result;
  }, {});
};

var convertParameter = function (parameter) {
  if (_.isPlainObject(parameter) && _.isString(parameter.$ref)) {
    return {
      $ref: rewriteRef(parameter.$ref)
    };
  }

  var converted = {
    name: parameter.name,
    in: parameter.in,
    description: parameter.description,
    required: parameter.required
  };
  var schema = parameter.schema;
  var mediaType;
  var mediaObject;

  if (!schema && _.isPlainObject(parameter.content)) {
    var picked = pickMediaType(parameter.content);

    if (picked) {
      mediaType = picked.mediaType;
      mediaObject = picked.mediaObject;
      schema = mediaObject ? mediaObject.schema : undefined;
    }
  }

  if (converted.in === 'body') {
    converted.schema = rewriteRefs(schema || {});
  } else {
    schema = schema || {};

    if (_.isString(schema.$ref)) {
      converted.type = 'string';
    } else {
      converted.type = schema.type || parameter.type || 'string';
      converted.format = schema.format || parameter.format;
      converted.enum = schema.enum || parameter.enum;
      converted.default = _.isUndefined(schema.default) ? parameter.default : schema.default;
      converted.minimum = schema.minimum;
      converted.maximum = schema.maximum;
      converted.minLength = schema.minLength;
      converted.maxLength = schema.maxLength;
      converted.pattern = schema.pattern;

      if (converted.type === 'array') {
        converted.items = rewriteRefs(schema.items || parameter.items || {});
        converted.collectionFormat = parameter.collectionFormat;
      }
    }
  }

  if (converted.in === 'cookie') {
    converted.in = 'header';
    converted['x-original-in'] = 'cookie';
  }

  if (mediaType) {
    converted['x-media-type'] = mediaType;
  }

  return _.omitBy(converted, _.isUndefined);
};

var resolveRequestBody = function (doc, requestBody) {
  if (_.isPlainObject(requestBody) && _.isString(requestBody.$ref) && requestBody.$ref.indexOf('#/components/requestBodies/') === 0) {
    var rbName = requestBody.$ref.substring('#/components/requestBodies/'.length);

    return _.get(doc, ['components', 'requestBodies', rbName]);
  }

  return requestBody;
};

var convertOperation = function (doc, pathItem, operation) {
  var converted = _.pick(operation, ['operationId', 'summary', 'description', 'tags', 'deprecated', 'security']);
  var allParameters = [];
  var consumes = [];

  _.each(pathItem.parameters || [], function (parameter) {
    allParameters.push(convertParameter(parameter));
  });

  _.each(operation.parameters || [], function (parameter) {
    allParameters.push(convertParameter(parameter));
  });

  if (operation.requestBody) {
    var requestBody = resolveRequestBody(doc, operation.requestBody);
    var pickedRequestBody = pickMediaType(_.get(requestBody, 'content'));

    if (pickedRequestBody && pickedRequestBody.mediaObject && pickedRequestBody.mediaObject.schema) {
      consumes.push(pickedRequestBody.mediaType);
      allParameters.push(_.omitBy({
        name: 'body',
        in: 'body',
        required: requestBody.required === true,
        description: requestBody.description,
        schema: rewriteRefs(pickedRequestBody.mediaObject.schema)
      }, _.isUndefined));
    }
  }

  converted.parameters = allParameters;

  if (consumes.length > 0) {
    converted.consumes = _.uniq(consumes);
  }

  converted.responses = _.reduce(operation.responses || {}, function (responses, responseObject, statusCode) {
    if (_.isPlainObject(responseObject) && _.isString(responseObject.$ref)) {
      responses[statusCode] = {
        $ref: rewriteRef(responseObject.$ref)
      };

      return responses;
    }

    var pickedResponse = pickMediaType(_.get(responseObject, 'content'));
    var convertedResponse = {
      description: (responseObject && responseObject.description) || ''
    };

    if (pickedResponse && pickedResponse.mediaObject && pickedResponse.mediaObject.schema) {
      convertedResponse.schema = rewriteRefs(pickedResponse.mediaObject.schema);
      converted.produces = _.uniq((converted.produces || []).concat([pickedResponse.mediaType]));
    }

    if (_.isPlainObject(responseObject) && _.isPlainObject(responseObject.headers)) {
      convertedResponse.headers = rewriteRefs(responseObject.headers);
    }

    responses[statusCode] = _.omitBy(convertedResponse, _.isUndefined);

    return responses;
  }, {});

  return _.omitBy(converted, _.isUndefined);
};

var convertPaths = function (doc) {
  return _.reduce(doc.paths || {}, function (paths, pathItem, pathName) {
    var convertedPathItem = _.reduce(operationMethods, function (acc, method) {
      if (_.isPlainObject(pathItem[method])) {
        acc[method] = convertOperation(doc, pathItem, pathItem[method]);
      }

      return acc;
    }, {});

    _.each(['parameters', 'x-swagger-router-controller'], function (key) {
      if (!_.isUndefined(pathItem[key])) {
        convertedPathItem[key] = rewriteRefs(_.cloneDeep(pathItem[key]));
      }
    });

    paths[pathName] = convertedPathItem;

    return paths;
  }, {});
};

module.exports.toSwagger2 = function (openapiDocument) {
  var doc = _.cloneDeep(openapiDocument);
  var serverDetails = getServerDetails(doc.servers);
  var converted = {
    swagger: '2.0',
    info: _.cloneDeep(doc.info),
    basePath: serverDetails.basePath,
    schemes: serverDetails.schemes,
    paths: convertPaths(doc),
    definitions: rewriteRefs(_.cloneDeep(_.get(doc, 'components.schemas', {}))),
    parameters: rewriteRefs(_.cloneDeep(_.get(doc, 'components.parameters', {}))),
    responses: rewriteRefs(_.cloneDeep(_.get(doc, 'components.responses', {}))),
    securityDefinitions: convertSecuritySchemes(_.get(doc, 'components.securitySchemes', {})),
    security: _.cloneDeep(doc.security),
    tags: _.cloneDeep(doc.tags),
    externalDocs: _.cloneDeep(doc.externalDocs),
    consumes: _.cloneDeep(doc.consumes),
    produces: _.cloneDeep(doc.produces),
    'x-original-openapi-version': doc.openapi
  };

  if (!converted.info) {
    converted.info = {
      title: 'Converted OpenAPI document',
      version: '1.0.0'
    };
  }

  converted = normalizeNullableSchemas(converted);

  return _.omitBy(converted, function (value) {
    return _.isUndefined(value) || (_.isArray(value) && value.length === 0) || (_.isPlainObject(value) && _.keys(value).length === 0);
  });
};