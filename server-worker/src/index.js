import { PairV2Hub } from './pair-v2-hub.js';
import { protocolSiteCss, renderProtocolSite } from './protocol-site.js';
import { corsPreflightResponse, cssResponse, errorResponse, htmlResponse, jsonResponse } from './shared.js';

export { PairV2Hub };

async function routeToHub(env, request) {
  const id = env.PAIR_V2_HUB.idFromName('global');
  const stub = env.PAIR_V2_HUB.get(id);
  return await stub.fetch(request);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method.toUpperCase();

    if (method === 'OPTIONS') {
      return corsPreflightResponse();
    }

    if ((method === 'GET' || method === 'HEAD') && (path === '/' || path === '/protocol')) {
      return htmlResponse(renderProtocolSite(url.origin));
    }

    if ((method === 'GET' || method === 'HEAD') && path === '/assets/protocol.css') {
      return cssResponse(protocolSiteCss);
    }

    if (method === 'GET' && path === '/healthz') {
      const upstream = await routeToHub(env, new Request(new URL('/internal/healthz', url), request));
      if (!upstream.ok) {
        return upstream;
      }
      const payload = await upstream.json();
      return jsonResponse({
        ...payload,
        domain: url.host,
        routes: {
          protocol: `${url.origin}/protocol`,
          v2: `${url.origin}/v2`,
        },
      });
    }

    if (path.startsWith('/v1/')) {
      return errorResponse(
        'NOT_IMPLEMENTED',
        'Cloudflare Worker deployment currently exposes the v2 control plane only. Keep the Go server for legacy /v1 routes.',
        501
      );
    }

    if (path.startsWith('/v2/')) {
      return await routeToHub(env, request);
    }

    return errorResponse('NOT_FOUND', 'Route not found', 404);
  },
};
