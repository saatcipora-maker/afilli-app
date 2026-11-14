import { Router, type IRouter } from "express";
import healthRouter from "./health";
import bulletinRouter from './bulletins';
import profileRouter from './profiles';
import messageRouter from './messages';
import writerRouter from './writer';
import writerMediaRouter from './writer-media';
import writerToolsRouter from './writer-tools';

const router: IRouter = Router();

router.use(healthRouter);
router.use(bulletinRouter);
router.use(profileRouter);
router.use(messageRouter);
router.use(writerRouter);
router.use(writerMediaRouter);
router.use(writerToolsRouter);

export default router;
