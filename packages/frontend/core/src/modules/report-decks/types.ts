import type {
  DeckAiOptionsResult,
  DeckCommandInput,
  DeckConfigInput,
  DeckDetail,
  DeckListResult,
  DeckPreflightResult,
  DeckShareView,
  DeckSourceRef,
  DeckStatus,
} from '@localmind/office/report-deck';

export type {
  DeckAiChoice,
  DeckAiOption,
  DeckAiOptionsResult,
  DeckCommandInput,
  DeckConfigInput,
  DeckDetail,
  DeckErrorCode,
  DeckListResult,
  DeckMode,
  DeckPhase,
  DeckPreflightResult,
  DeckProgress,
  DeckScope,
  DeckScopeKind,
  DeckShareView,
  DeckSourceReason,
  DeckSourceRef,
  DeckSourceView,
  DeckStatus,
  DeckSummary,
} from '@localmind/office/report-deck';

/** Result of `reportDeckCommand`, parsed loosely. */
export type DeckCommandResponse = {
  deck?: DeckDetail;
  share?: DeckShareView;
  deleted?: boolean;
};

/** Owner-side client: GraphQL for state, REST for the generated HTML. */
export interface ReportDeckApi {
  list(input: {
    cursor?: string | null;
    limit?: number;
    signal?: AbortSignal;
  }): Promise<DeckListResult>;
  get(deckId: string, signal?: AbortSignal): Promise<DeckDetail>;
  preflight(
    sources: DeckSourceRef[],
    signal?: AbortSignal
  ): Promise<DeckPreflightResult>;
  aiOptions(
    sources: DeckSourceRef[],
    signal?: AbortSignal
  ): Promise<DeckAiOptionsResult>;
  command(input: DeckCommandInput): Promise<DeckCommandResponse>;
  fetchHtml(deckId: string, signal?: AbortSignal): Promise<string>;
  htmlUrl(deckId: string, download?: boolean): string;
}

/** Preferences remembered between sessions (never sources, AI, title or instructions). */
export type DeckLastConfig = Partial<
  Pick<
    DeckConfigInput,
    | 'mode'
    | 'templateKey'
    | 'customStyle'
    | 'accentColor'
    | 'purpose'
    | 'audience'
    | 'length'
    | 'language'
    | 'tone'
    | 'preferences'
  >
>;

export const ACTIVE_DECK_STATUSES: ReadonlySet<DeckStatus> = new Set([
  'queued',
  'generating',
]);

export type DeckShareOpenResult =
  | {
      status: 'ok';
      title: string;
      allowDownload: boolean;
      slideCount: number | null;
    }
  | {
      status:
        | 'password_required'
        | 'invalid_password'
        | 'invalid_token'
        | 'expired'
        | 'revoked'
        | 'error';
    };
