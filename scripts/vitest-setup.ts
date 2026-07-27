import { ProxyAgent, setGlobalDispatcher } from 'undici'

/**
 * Node's built-in `fetch` ignores `http_proxy` / `https_proxy` — unlike curl, axios, or most other
 * clients, it needs a dispatcher wired up explicitly.
 *
 * That matters beyond the test runner. op.gg and Data Dragon are reached over a proxy by a large
 * share of the players this project targets, and code that works when exercised with curl but not
 * through `fetch` is exactly the sort of discrepancy that only shows up on someone else's machine.
 */
const proxy =
  process.env.https_proxy ||
  process.env.HTTPS_PROXY ||
  process.env.http_proxy ||
  process.env.HTTP_PROXY

if (proxy) {
  setGlobalDispatcher(new ProxyAgent(proxy))
}
