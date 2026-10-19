import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { z } from 'zod';

import { AccessDenied, Throttle } from '../../base';
import { Models } from '../../models';
import { CurrentUser, type CurrentUser as User, Public } from '../auth';
import {
  deckDownloadDisposition,
  deckShareCookieName,
  DeckShareError,
  deckSharePath,
  inflateDeckHtml,
  ReportDeckShareService,
} from './share';

function htmlHeaders(response: Response) {
  response.setHeader('content-type', 'text/html; charset=utf-8');
  response.setHeader('cache-control', 'private, no-store');
  response.setHeader('x-content-type-options', 'nosniff');
  response.setHeader('x-robots-tag', 'noindex, nofollow, noarchive');
  response.setHeader('referrer-policy', 'no-referrer');
  // Opened directly, the deck still runs without same-origin access.
  response.setHeader('content-security-policy', 'sandbox allow-scripts');
}

function jsonHeaders(response: Response) {
  response.setHeader('cache-control', 'private, no-store');
  response.setHeader('x-content-type-options', 'nosniff');
  response.setHeader('x-robots-tag', 'noindex, nofollow, noarchive');
  response.setHeader('referrer-policy', 'no-referrer');
}

const isDownload = (value: unknown) => value === '1' || value === 'true';

@Controller('/api/report-decks/:deckId')
export class ReportDeckController {
  constructor(private readonly models: Models) {}

  @Get('/html')
  @Throttle('default', { bucket: 'report-deck-html' })
  async html(
    @CurrentUser() user: User,
    @Param('deckId') deckId: string,
    @Query('download') download: string | undefined,
    @Res() response: Response
  ) {
    const deck = await this.models.reportDeck.html(user.id, deckId);
    const html =
      deck?.status === 'ready' ? inflateDeckHtml(deck.htmlGzip) : null;
    if (!deck || html === null)
      throw new AccessDenied('Report deck is unavailable');
    htmlHeaders(response);
    if (isDownload(download))
      response.setHeader(
        'content-disposition',
        deckDownloadDisposition(deck.title)
      );
    response.send(html);
  }
}

@Controller('/api/deck-shares/:shareId')
export class ReportDeckShareController {
  constructor(private readonly shares: ReportDeckShareService) {}

  private fail(response: Response, error: unknown) {
    if (!(error instanceof DeckShareError)) throw error;
    jsonHeaders(response);
    response.status(error.status).json({ code: error.code });
  }

  @Public()
  @Post()
  @Throttle('strict')
  async open(
    @Param('shareId') shareId: string,
    @Body() raw: unknown,
    @Req() request: Request,
    @Res() response: Response
  ) {
    const body = z
      .object({
        token: z.string().min(1).max(2048),
        password: z.string().max(256).optional(),
      })
      .strict()
      .safeParse(raw);
    if (!body.success)
      return this.fail(response, new DeckShareError('invalid_token'));
    try {
      const session = await this.shares.open({ shareId, ...body.data });
      response.cookie(deckShareCookieName(shareId), session.cookie, {
        httpOnly: true,
        secure: request.secure,
        sameSite: 'strict',
        path: deckSharePath(shareId),
        expires: new Date(session.expiresAt),
      });
      jsonHeaders(response);
      response.json(session.view);
    } catch (error) {
      this.fail(response, error);
    }
  }

  @Public()
  @Get('/html')
  @Throttle('default', { bucket: 'report-deck-share-html' })
  async html(
    @Param('shareId') shareId: string,
    @Query('download') download: string | undefined,
    @Req() request: Request,
    @Res() response: Response
  ) {
    try {
      const result = await this.shares.html({
        shareId,
        cookie: request.cookies?.[deckShareCookieName(shareId)] as
          | string
          | undefined,
        download: isDownload(download),
      });
      htmlHeaders(response);
      if (isDownload(download))
        response.setHeader(
          'content-disposition',
          deckDownloadDisposition(result.title)
        );
      response.send(result.html);
    } catch (error) {
      this.fail(response, error);
    }
  }
}
