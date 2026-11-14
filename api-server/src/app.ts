import express, { type Express, type ErrorRequestHandler } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";
import { clerkMiddleware, getAuth } from '@clerk/express';
import { publishableKeyFromHost } from '@clerk/shared/keys';
import { CLERK_PROXY_PATH, clerkProxyMiddleware, getClerkProxyHost } from './middlewares/clerkProxyMiddleware';

const app: Express = express();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(CLERK_PROXY_PATH, clerkProxyMiddleware());
app.use(cors({ credentials: true, origin: true }));
app.use(clerkMiddleware((req) => ({
  publishableKey: publishableKeyFromHost(getClerkProxyHost(req) ?? '', process.env.CLERK_PUBLISHABLE_KEY),
})));
// Larger manuscript/audio bodies remain authenticated and bounded.
app.use(['/api/writer-books', '/api/writer-voice'], (req, res, next) => {
  if (req.method !== 'GET' && !getAuth(req).userId) { res.status(401).json({ error: 'Devam etmek için giriş yap.' }); return; }
  next();
});
app.use('/api/writer-books', express.json({ limit: '32mb' }));
app.use('/api/writer-voice', express.json({ limit: '16mb' }));
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));

app.use("/api", router);
const bodyErrors: ErrorRequestHandler = (error, _req, res, next) => {
  if (error?.type === 'entity.too.large') { res.status(413).json({ error: 'Kitap kaydı veya ses dosyası çok büyük. Yerel kaydını silmeden boyutu azaltıp yeniden dene.' }); return; }
  if (error?.type === 'entity.parse.failed') { res.status(400).json({ error: 'Gönderilen kayıt okunamadı. Yerel kaydını silmeden yeniden dene.' }); return; }
  next(error);
};
app.use(bodyErrors);

export default app;
