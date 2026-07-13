import { Router, type IRouter } from "express";
import healthRouter from "./health";
import authRouter from "./auth";
import usersRouter from "./users";
import auditLogsRouter from "./audit-logs";
import dashboardRouter from "./dashboard";
import clientsRouter from "./clients";
import documentsRouter from "./documents";
import missionsRouter from "./missions";
import accountingRouter from "./accounting";
import caisseRouter from "./caisse";
import reportingRouter from "./reporting";
import fixedAssetsRouter from "./fixed-assets";
import financialItemsRouter from "./financial-items";
import closingRouter from "./closing";

const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);
router.use(usersRouter);
router.use(auditLogsRouter);
router.use(dashboardRouter);
router.use(clientsRouter);
router.use(documentsRouter);
router.use(missionsRouter);
router.use(accountingRouter);
router.use(caisseRouter);
router.use(reportingRouter);
router.use(fixedAssetsRouter);
router.use(financialItemsRouter);
router.use(closingRouter);

export default router;
