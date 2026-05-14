# OpenAPI 3.x Compatibility Matrix

This project is still internally implemented as Swagger 1.2/2.0 middleware. OpenAPI 3.x support is provided by converting OpenAPI 3.x documents to Swagger 2.0 during middleware initialization.

## Status Key

- `Supported`: Implemented and covered by automated tests
- `Partial`: Works for common cases but has known gaps
- `Not Supported`: Not currently implemented

## Feature Matrix

| Feature | Status | Notes | Test Coverage |
| --- | --- | --- | --- |
| OpenAPI 3.x document detection (`openapi: 3.x`) | Supported | Auto-normalized to internal Swagger 2.0 before validation/routing | `test/2.0/test-openapi3-support.js` |
| `servers` URL to routing base path | Supported | First server path maps to Swagger 2.0 `basePath` | `test/2.0/test-openapi3-compat-matrix.js` |
| `components.schemas` | Supported | Converted to Swagger 2.0 `definitions` with reference rewriting | `test/2.0/test-openapi3-support.js` |
| `components.parameters` and parameter `$ref` | Supported | Converted to Swagger 2.0 `parameters` refs | `test/2.0/test-openapi3-compat-matrix.js` |
| `requestBody` (inline and `$ref`) | Supported | Converted to Swagger 2.0 body parameter with schema and required flag | `test/2.0/test-openapi3-compat-matrix.js` |
| Response `content` schema conversion | Supported | Prefers `application/json`, else first media type | `test/2.0/test-openapi3-support.js` |
| HTTP bearer security scheme | Supported | Mapped to Swagger 2.0 `apiKey` header (`Authorization`) for middleware auth handlers | `test/2.0/test-openapi3-compat-matrix.js` |
| Cookie parameters | Supported | Converted metadata preserves cookie origin and reads from `Cookie` header | `test/2.0/test-openapi3-compat-matrix.js` |
| `nullable: true` schemas | Supported | Normalized to Swagger-compatible `type: [<type>, 'null']` plus `x-nullable` hint | `test/2.0/test-openapi3-compat-matrix.js` |
| Multipart requestBody encoding semantics | Partial | Basic multipart handling works via existing middleware, complex OAS3 encoding object not fully modeled | Existing multipart tests (Swagger 1.2/2.0) |
| OAuth2 flow details parity | Partial | Core flows are mapped; advanced OAS3 semantics may lose fidelity | Existing security tests + manual validation |
| `oneOf` / `anyOf` / `not` advanced composition semantics | Partial | Passed through where possible, behavior depends on underlying Swagger 2.0 validators | Not yet dedicated |
| Callbacks / Links / Webhooks | Not Supported | No Swagger 2.0 equivalent in middleware model | None |

## Implementation Strategy

1. Convert OpenAPI 3.x into Swagger 2.0-compatible shape.
2. Keep public middleware API stable and unchanged.
3. Add failing-first compatibility tests for unsupported key features.
4. Implement missing behavior incrementally and keep matrix updated.
