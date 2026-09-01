// import { Request, Response } from 'express';
// import logger from '../utils/logger';
// import xeroService from '../services/xero.service';
// import { encrypt } from '../services/encryption.service';
// import { updateXeroConfig } from '../repositories/dynamo.xeroconfig.repository';

// export const xeroController = {
//   // GET /connect → redirects user to Xero login
//   redirectToXero: (req: Request, res: Response): void => {
//     try {
//       const url = xeroService.getAuthUrl();
//       logger.info('Redirecting user to Xero login');
//       // Explicitly prevent any caching of this response (browser, proxy, or
//       // API Gateway/CDN in front of the app). Previously this returned a
//       // static HTML link via res.send(), which Express auto-ETags — since
//       // the link never changes, repeat visits could get served a cached
//       // 304 with no body, silently preventing the redirect from ever
//       // reaching Xero.
//       res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
//       res.set('Pragma', 'no-cache');
//       res.set('Expires', '0');
//       res.redirect(url);
//     } catch (error) {
//       logger.error('Error generating Xero auth URL', error);
//       res
//         .status(500)
//         .json({ success: false, error: error instanceof Error ? error.message : 'Unknown error' });
//     }
//   },

//   // GET /callback → Xero sends authorization code here
//   handleCallback: async (req: Request, res: Response): Promise<void> => {
//     try {
//       const code = req.query.code as string;
//       if (!code) {
//         res.status(400).json({ success: false, error: 'Authorization code missing' });
//         return;
//       }
//       logger.info('Received Xero callback, exchanging code for tokens');

//       // Exchange code for access + refresh tokens
//       const tokens = await xeroService.exchangeCodeForToken(code);

//       // Fetch Xero tenants
//       const tenants = await xeroService.getTenants(tokens.access_token);

//       if (!tenants || tenants.length === 0) {
//         throw new Error('No Xero tenants returned');
//       }
//       // Encrypt the refresh token before saving
//       const encryptedRefreshToken = encrypt(tokens.refresh_token);

//       //  Save encrypted refresh token + initial sync timestamps in DynamoDB
//       await updateXeroConfig(tenants[0].tenantId, {
//         refreshTokenEncrypted: encryptedRefreshToken,
//       });

//       // Respond to client
//       res.status(200).json({
//         success: true,
//         message: 'Xero connected!',
//         tokens,
//         tenants,
//       });
//     } catch (error) {
//       logger.error('Error handling Xero callback', error);
//       res.status(500).json({
//         success: false,
//         error: error instanceof Error ? error.message : 'Unknown error',
//       });
//     }
//   },
//   fetchBills: async (req: Request, res: Response): Promise<void> => {
//     try {
//       // In a real app, you’d store these tokens after callback
//       const accessToken = req.query.access_token as string;
//       const tenantId = req.query.tenant_id as string;

//       if (!accessToken || !tenantId) {
//         res.status(400).json({ success: false, error: 'Missing accessToken or tenantId' });
//         return;
//       }

//       const bills = await xeroService.getBills(accessToken, tenantId);

//       logger.info('Fetched bills from Xero', bills);
//       res.status(200).json({ success: true, data: bills });
//     } catch (error) {
//       logger.error('Error fetching bills', error);
//       res
//         .status(500)
//         .json({ success: false, error: error instanceof Error ? error.message : 'Unknown error' });
//     }
//   },

//   fetchInvoices: async (req: Request, res: Response): Promise<void> => {
//     try {
//       const accessToken = req.query.access_token as string;
//       const tenantId = req.query.tenant_id as string;

//       if (!accessToken || !tenantId) {
//         res.status(400).json({ success: false, error: 'Missing accessToken or tenantId' });
//         return;
//       }

//       const invoices = await xeroService.getInvoices(accessToken, tenantId);

//       logger.info('Fetched invoices from Xero', invoices);
//       res.status(200).json({ success: true, data: invoices });
//     } catch (error) {
//       logger.error('Error fetching invoices', error);
//       res
//         .status(500)
//         .json({ success: false, error: error instanceof Error ? error.message : 'Unknown error' });
//     }
//   },
// };

import crypto from 'crypto';
import { Request, Response } from 'express';
import logger from '../utils/logger';
import xeroService from '../services/xero.service';
import { encrypt } from '../services/encryption.service';
import { updateXeroConfig } from '../repositories/dynamo.xeroconfig.repository';

const STATE_COOKIE = 'xero_oauth_state';

export const xeroController = {
  // GET /connect → redirects user to Xero login
  redirectToXero: (req: Request, res: Response): void => {
    try {
      const state = crypto.randomUUID();

      // Requires cookie-parser + app.use(cookieParser()) in server.ts,
      // and CORS credentials to actually be allowed cross-origin (see
      // server.ts notes) — otherwise this cookie never round-trips and
      // handleCallback below will always reject with a state mismatch.
      res.cookie(STATE_COOKIE, state, {
        httpOnly: true,
        secure: true, // requires HTTPS end-to-end (fine behind trust proxy + ALB/CloudFront on https)
        sameSite: 'lax', // use 'none' instead if /connect and /callback are on different domains
        maxAge: 5 * 60 * 1000, // matches Xero's 5-minute auth code expiry
      });

      const url = xeroService.getAuthUrl(state);
      logger.info('Redirecting user to Xero login');

      res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
      res.set('Pragma', 'no-cache');
      res.set('Expires', '0');
      res.redirect(url);
    } catch (error) {
      logger.error('Error generating Xero auth URL', error);
      res
        .status(500)
        .json({ success: false, error: error instanceof Error ? error.message : 'Unknown error' });
    }
  },

  // GET /callback → Xero sends authorization code here
  handleCallback: async (req: Request, res: Response): Promise<void> => {
    try {
      const code = req.query.code as string;
      const returnedState = req.query.state as string;
      const expectedState = req.cookies?.[STATE_COOKIE];

      res.clearCookie(STATE_COOKIE);

      if (!returnedState || !expectedState || returnedState !== expectedState) {
        logger.error(
          `Xero OAuth state mismatch — expected=${expectedState ?? 'undefined'} returned=${returnedState ?? 'undefined'}`
        );
        res.status(400).json({ success: false, error: 'Invalid or missing state parameter' });
        return;
      }

      if (!code) {
        res.status(400).json({ success: false, error: 'Authorization code missing' });
        return;
      }

      logger.info('Received Xero callback, exchanging code for tokens');

      const tokens = await xeroService.exchangeCodeForToken(code);
      const tenants = await xeroService.getTenants(tokens.access_token);

      if (!tenants || tenants.length === 0) {
        throw new Error('No Xero tenants returned');
      }

      const encryptedRefreshToken = encrypt(tokens.refresh_token);

      await updateXeroConfig(tenants[0].tenantId, {
        refreshTokenEncrypted: encryptedRefreshToken,
      });

      res.status(200).json({
        success: true,
        message: 'Xero connected!',
        tokens,
        tenants,
      });
    } catch (error) {
      logger.error('Error handling Xero callback', error);
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  },

  fetchBills: async (req: Request, res: Response): Promise<void> => {
    try {
      const accessToken = req.query.access_token as string;
      const tenantId = req.query.tenant_id as string;

      if (!accessToken || !tenantId) {
        res.status(400).json({ success: false, error: 'Missing accessToken or tenantId' });
        return;
      }

      const bills = await xeroService.getBills(accessToken, tenantId);

      logger.info('Fetched bills from Xero', bills);
      res.status(200).json({ success: true, data: bills });
    } catch (error) {
      logger.error('Error fetching bills', error);
      res
        .status(500)
        .json({ success: false, error: error instanceof Error ? error.message : 'Unknown error' });
    }
  },

  fetchInvoices: async (req: Request, res: Response): Promise<void> => {
    try {
      const accessToken = req.query.access_token as string;
      const tenantId = req.query.tenant_id as string;

      if (!accessToken || !tenantId) {
        res.status(400).json({ success: false, error: 'Missing accessToken or tenantId' });
        return;
      }

      const invoices = await xeroService.getInvoices(accessToken, tenantId);

      logger.info('Fetched invoices from Xero', invoices);
      res.status(200).json({ success: true, data: invoices });
    } catch (error) {
      logger.error('Error fetching invoices', error);
      res
        .status(500)
        .json({ success: false, error: error instanceof Error ? error.message : 'Unknown error' });
    }
  },
};

export default xeroController;
