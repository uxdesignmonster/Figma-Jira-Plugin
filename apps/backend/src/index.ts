import "dotenv/config";
import express from "express";
import cors from "cors";
import { healthRouter } from "./routes/health.js";

const app = express();
const port = Number(process.env.PORT ?? 4000);

app.use(cors());
app.use(express.json());

app.use("/health", healthRouter);

app.listen(port, () => {
  console.log(`[backend] listening on http://localhost:${port}`);
});
