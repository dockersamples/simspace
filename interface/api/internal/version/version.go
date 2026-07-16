package version

// Version mirrors the api/src/version.js constant in the Node implementation.
// It can be overridden at build time with:
//
//	go build -ldflags "-X .../version.Version=<value>"
var Version = "local-dev"
