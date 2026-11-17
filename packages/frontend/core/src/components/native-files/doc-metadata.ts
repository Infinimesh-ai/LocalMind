import { combineLatest, type Observable, of, switchMap } from 'rxjs';

/**
 * Combine one metadata stream per doc into a list.
 *
 * Each doc stream is subscribed once per docs list emission. A change on one
 * doc only re-emits the combined list, unlike `LiveData.computed`, which
 * unsubscribes and re-subscribes every dependency on each change. With N docs
 * receiving N property updates at once (cold sync of docProperties), the
 * computed form is O(N^2) subscriptions and froze the main thread for seconds.
 */
export function combineDocMetadata<Doc, Metadata>(
  docs$: Observable<readonly Doc[]>,
  project: (doc: Doc) => Observable<Metadata>
): Observable<Metadata[]> {
  return docs$.pipe(
    switchMap(docs =>
      docs.length === 0 ? of([]) : combineLatest(docs.map(doc => project(doc)))
    )
  );
}
