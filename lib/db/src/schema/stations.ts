import { integer, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { clientsTable } from "./clients";

// Multi-station architecture (P8): a single PME client may own multiple
// physical gas stations in different cities. Each station is an independent
// operational unit — pumps, staff, and accounting entries are all scoped
// to a single station. "client_pme" and cabinet staff have cross-station
// visibility (stationId = null in their JWT); POMPISTE and station-level
// staff carry a stationId that restricts every operation to their site.
export const stationsTable = pgTable("stations", {
  id: serial("id").primaryKey(),
  clientId: integer("client_id")
    .notNull()
    .references(() => clientsTable.id, { onDelete: "cascade" }),
  name: text("name").notNull(), // e.g. "Station Yamoussoukro Autogare"
  city: text("city").notNull(), // e.g. "Yamoussoukro"
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertStationSchema = createInsertSchema(stationsTable).omit({
  id: true,
  createdAt: true,
});
export type InsertStation = z.infer<typeof insertStationSchema>;
export type Station = typeof stationsTable.$inferSelect;
