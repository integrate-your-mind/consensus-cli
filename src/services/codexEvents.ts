import { Context, Effect, Layer, Ref, Option } from "effect";
import type { CodexEvent, ThreadState } from "../codex/types.js";

/**
 * Service for managing Codex events and thread state
 * Uses Effect for async operations and state management
 */
export class CodexEventService extends Context.Tag("CodexEventService")<
  CodexEventService,
  {
    readonly handleEvent: (event: CodexEvent) => Effect.Effect<void>;
    readonly getThreadState: (threadId: string) => Effect.Effect<Option.Option<ThreadState>>;
    readonly getAllActiveThreads: () => Effect.Effect<ReadonlyMap<string, ThreadState>>;
  }
>() {}

/**
 * Live implementation of CodexEventService
 * Uses Ref for concurrent state management
 */
export const CodexEventServiceLive = Layer.effect(
  CodexEventService,
  Effect.gen(function* () {
    const stateRef = yield* Ref.make(new Map<string, ThreadState>());
    
    const handleEvent = (event: CodexEvent): Effect.Effect<void> =>
      Effect.gen(function* () {
        yield* Ref.update(stateRef, (map) => {
          const current = map.get(event.threadId);
          const turnIdStr = event.turnId?.toString() ?? "";
          
          switch (event.type) {
            case "thread.started":
            case "turn.started":
              return new Map(map).set(event.threadId, {
                inFlight: true,
                lastActivityAt: event.timestamp,
                activeItems: current?.activeItems ?? new Set()
              });
              
            case "item.started": {
              const items = new Set(current?.activeItems ?? []);
              if (turnIdStr) items.add(turnIdStr);
              return new Map(map).set(event.threadId, {
                inFlight: true,
                lastActivityAt: event.timestamp,
                activeItems: items
              });
            }
              
            case "item.completed": {
              const items = new Set(current?.activeItems ?? []);
              items.delete(turnIdStr);
              return new Map(map).set(event.threadId, {
                inFlight: items.size > 0,
                lastActivityAt: event.timestamp,
                activeItems: items
              });
            }
              
            case "agent-turn-complete":
              return new Map(map).set(event.threadId, {
                inFlight: false,
                lastActivityAt: event.timestamp,
                activeItems: new Set()
              });
            
            default:
              // Exhaustive check - should never reach here
              return map;
          }
        });
        
        yield* Effect.log(`[Codex] ${event.type} thread=${event.threadId}`);
      });
    
    const getThreadState = (threadId: string) =>
      Ref.get(stateRef).pipe(
        Effect.map((map) => Option.fromNullable(map.get(threadId)))
      );
    
    const getAllActiveThreads = () => Ref.get(stateRef);
    
    return { handleEvent, getThreadState, getAllActiveThreads };
  })
);

/**
 * Singleton store for non-Effect code (scan.ts)
 * Maintains same state as the Effect service
 */
class CodexEventStore {
  private state = new Map<string, ThreadState>();
  
  handleEvent(event: CodexEvent): void {
    const current = this.state.get(event.threadId);
    const turnIdStr = event.turnId?.toString() ?? "";
    
    switch (event.type) {
      case "thread.started":
      case "turn.started":
        this.state.set(event.threadId, {
          inFlight: true,
          lastActivityAt: event.timestamp,
          activeItems: current?.activeItems ?? new Set()
        });
        break;
        
      case "item.started": {
        const items = new Set(current?.activeItems ?? []);
        if (turnIdStr) items.add(turnIdStr);
        this.state.set(event.threadId, {
          inFlight: true,
          lastActivityAt: event.timestamp,
          activeItems: items
        });
        break;
      }
        
      case "item.completed": {
        const items = new Set(current?.activeItems ?? []);
        items.delete(turnIdStr);
        this.state.set(event.threadId, {
          inFlight: items.size > 0,
          lastActivityAt: event.timestamp,
          activeItems: items
        });
        break;
      }
        
      case "agent-turn-complete":
        this.state.set(event.threadId, {
          inFlight: false,
          lastActivityAt: event.timestamp,
          activeItems: new Set()
        });
        break;
    }
  }
  
  getThreadState(threadId: string): ThreadState | undefined {
    return this.state.get(threadId);
  }
  
  getAllThreads(): ReadonlyMap<string, ThreadState> {
    return this.state;
  }
}

// Export singleton instance for use in scan.ts
export const codexEventStore = new CodexEventStore();
