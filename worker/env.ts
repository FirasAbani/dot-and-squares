/**
 * Bindings, in their own file so `GameRoom` can reach `LOBBY` without importing
 * the router that imports it back.
 */
export interface Env {
  ROOM: DurableObjectNamespace;
  LOBBY: DurableObjectNamespace;
  ASSETS: Fetcher;
}

/**
 * The lobby is a singleton: one object, one name, every browser and every room
 * talking to the same instance.
 */
export const LOBBY_SINGLETON = 'global';
