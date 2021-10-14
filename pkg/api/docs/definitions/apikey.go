package apidocs

import (
	"github.com/grafana/grafana/pkg/api/dtos"
	"github.com/grafana/grafana/pkg/models"
)

// swagger:route GET /auth/keys apikeys getAPIkeys
//
// Get auth keys
//
// Will return auth keys.
//
// Responses:
// 200: apikeyResponse
// 401: unauthorisedError
// 403: forbiddenError
// 404: notFoundError
// 500: internalServerError

// swagger:route POST /auth/keys apikeys addAPIkey
//
// Creates an API key
//
// Will return details of the created API key
//
// Responses:
// 200: newAPIkeyResponse
// 400: badRequestError
// 401: unauthorisedError
// 403: forbiddenError
// 403: quotaReachedError
// 409: dublicateAPIkeyError
// 500: internalServerError

// swagger:route DELETE /auth/keys/{id} apikeys deleteAPIkey
//
// Delete API key
//
// Responses:
// 200: okResponse
// 401: unauthorisedError
// 403: forbiddenError
// 404: notFoundError
// 500: internalServerError

// swagger:parameters getAPIkeys
type GetAPIkeysParams struct {
	// Show expired keys
	// in:query
	// required:false
	// default:false
	IncludeExpired bool `json:"includeExpired"`
}

// swagger:parameters addAPIkey
type AddAPIkeyParams struct {
	// in:body
	Body models.AddApiKeyCommand
}

// swagger:parameters deleteAPIkey
type DeleteAPIkeyParams struct {
	// in:path
	// required:true
	ID int64 `json:"id"`
}

// swagger:response apikeyResponse
type APIkeyResponse struct {
	// The response message
	// in: body
	Body []*models.ApiKeyDTO `json:"body"`
}

// swagger:response newAPIkeyResponse
type NewAPIkeyResponse struct {
	// The response message
	// in: body
	Body dtos.NewApiKeyResult `json:"body"`
}
