/**
 * The global fetch, callable from anywhere. Workers throw "Illegal invocation" when fetch
 * is called as another object's method (`this.fetchImpl(…)`), so classes that keep a
 * fetch default to this instead of the global itself.
 */
export const globalFetch = Object.assign((input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => fetch(input, init), fetch) as typeof fetch;
