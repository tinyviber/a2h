import type { ActionView, RunView } from '../types';
import { createMockExecutor } from './mock';
import { createRegistry, type ActionExecutor, type ProviderRegistry } from './types';

// Composition point for the provider layer. A real integration would be added
// here (and only here):
//
//   createDefaultRegistry({ extraExecutors: [createWorkBuddyExecutor()] })
//
// Executors are consulted in order, so a real provider registered first simply
// shadows the mock for the actions it claims to handle.

export interface RegistryOptions {
  extraExecutors?: ActionExecutor[];
  /** Disable the built-in simulator entirely (used by tests). */
  withoutMock?: boolean;
}

export function createDefaultRegistry(options: RegistryOptions = {}): ProviderRegistry {
  const executors: ActionExecutor[] = [...(options.extraExecutors ?? [])];
  if (!options.withoutMock) executors.push(createMockExecutor());
  return createRegistry(executors);
}

export { createMockExecutor } from './mock';
export type {
  ActionExecutor,
  ActionResolution,
  ProviderRegistry,
  ExecutionOutcome,
  ActionContext,
} from './types';

/** Everything a caller needs to reason about run provenance. */
export function describeProviders(registry: ProviderRegistry): string {
  return registry.executors.map((e) => `${e.id} (${e.description})`).join('; ');
}
