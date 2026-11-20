import { integer, real, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const tickets = sqliteTable("tickets", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  store: text("store").notNull(),
  ticketDate: text("ticket_date").notNull(), // YYYY-MM-DD
  folio: text("folio").notNull(),
  amount: real("amount").notNull(),
  status: text("status", { enum: ["pendiente", "facturado"] })
    .notNull()
    .default("pendiente"),
  invoiceFolio: text("invoice_folio"),
  invoiceDate: text("invoice_date"), // YYYY-MM-DD
  code: text("code"),
  note: text("note"),
  isGasoline: integer("is_gasoline", { mode: "boolean" })
    .notNull()
    .default(true),
  photoBlobKey: text("photo_blob_key"),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const fiscalProfile = sqliteTable("fiscal_profile", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  rfc: text("rfc").notNull(),
  regime: text("regime").notNull(),
  postalCode: text("postal_code").notNull(),
  email: text("email").notNull(),
  address: text("address").notNull(),
});

export const portals = sqliteTable("portals", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  url: text("url").notNull(),
  username: text("username"),
  note: text("note"),
});
