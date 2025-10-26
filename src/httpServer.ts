import express from "express";
import cors from "cors";
import { randomUUID } from "crypto";
import type { Request, Response } from "express";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createTimerServer } from "./server.js";

const PORT = Number(process.env.PORT ?? 2091);

async function bootstrap() {
  const { server } = await createTimerServer();

  const app = express();
  app.use(express.json({ limit: "2mb" }));
  app.use(
    cors({
      origin: "*",
      exposedHeaders: ["Mcp-Session-Id"]
    })
  );

  const transports = new Map<string, StreamableHTTPServerTransport>();

  const createTransport = () => {
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: sessionId => {
        transports.set(sessionId, transport);
      },
      onsessionclosed: sessionId => {
        transports.delete(sessionId);
      }
    });

    transport.onclose = () => {
      const sessionId = transport.sessionId;
      if (sessionId) {
        transports.delete(sessionId);
      }
    };

    return transport;
  };

  app.post("/mcp", async (req: Request, res: Response) => {
    const sessionId = req.header("mcp-session-id") ?? undefined;

    try {
      if (sessionId) {
        const existing = transports.get(sessionId);
        if (!existing) {
          res.status(404).json({
            error: "unknown_session",
            message: "Session not found. Start a new session to initialize."
          });
          return;
        }
        await existing.handleRequest(req, res, req.body);
        return;
      }

      const transport = createTransport();
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (error) {
      console.error("Error handling MCP POST request", error);
      if (!res.headersSent) {
        res.status(500).json({
          error: "internal_error",
          message: "TimerGPT encountered an unexpected error."
        });
      }
    }
  });

  app.get("/mcp", async (req: Request, res: Response) => {
    const sessionId = req.header("mcp-session-id") ?? undefined;
    if (!sessionId) {
      res.status(400).json({
        error: "missing_session",
        message: "Provide an MCP-Session-Id header to resume streaming."
      });
      return;
    }

    const transport = transports.get(sessionId);
    if (!transport) {
      res.status(404).json({
        error: "unknown_session",
        message: "Session not found. Start a new session to initialize."
      });
      return;
    }

    try {
      await transport.handleRequest(req, res);
    } catch (error) {
      console.error("Error handling MCP GET stream", error);
      if (!res.headersSent) {
        res.status(500).json({
          error: "internal_error",
          message: "Failed to stream MCP updates."
        });
      }
    }
  });

  app.delete("/mcp", async (req: Request, res: Response) => {
    const sessionId = req.header("mcp-session-id") ?? undefined;
    if (!sessionId) {
      res.status(400).json({
        error: "missing_session",
        message: "Provide an MCP-Session-Id header to close a session."
      });
      return;
    }

    const transport = transports.get(sessionId);
    if (!transport) {
      res.status(404).json({
        error: "unknown_session",
        message: "Session not found."
      });
      return;
    }

    try {
      await transport.handleRequest(req, res);
    } catch (error) {
      console.error("Error handling MCP DELETE request", error);
      if (!res.headersSent) {
        res.status(500).json({
          error: "internal_error",
          message: "Failed to close MCP session."
        });
      }
    } finally {
      const session = transport.sessionId;
      if (session) {
        transports.delete(session);
      }
    }
  });

  const serverInstance = app.listen(PORT, () => {
    console.log(`TimerGPT MCP HTTP server listening on port ${PORT}`);
  });

  const shutdown = async () => {
    console.log("Shutting down TimerGPT server...");
    serverInstance.close();
    await Promise.all(
      [...transports.values()].map(async transport => {
        try {
          await transport.close();
        } catch (error) {
          console.error("Error closing transport", error);
        }
      })
    );
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

bootstrap().catch(error => {
  console.error("Failed to start TimerGPT HTTP server", error);
  process.exit(1);
});

