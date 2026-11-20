import { defineAction, z, type ActionsModule, type Ctx } from "@hatch/space-sdk";
import { asc, desc, eq } from "drizzle-orm";
import * as schema from "./schema";

const ticketOut = z.object({
  id: z.number(),
  store: z.string(),
  ticketDate: z.string(),
  folio: z.string(),
  amount: z.number(),
  status: z.enum(["pendiente", "facturado"]),
  invoiceFolio: z.string().nullable(),
  invoiceDate: z.string().nullable(),
  code: z.string().nullable(),
  note: z.string().nullable(),
  isGasoline: z.boolean(),
  photoUrl: z.string().nullable(),
});

type TicketOut = z.infer<typeof ticketOut>;

type TicketRow = typeof schema.tickets.$inferSelect;

async function toTicketOut(ctx: Ctx, row: TicketRow): Promise<TicketOut> {
  let photoUrl: string | null = null;
  if (row.photoBlobKey) {
    try {
      photoUrl = await ctx.blobs.getUrl(row.photoBlobKey);
    } catch {
      photoUrl = null;
    }
  }
  return {
    id: row.id,
    store: row.store,
    ticketDate: row.ticketDate,
    folio: row.folio,
    amount: row.amount,
    status: row.status,
    invoiceFolio: row.invoiceFolio,
    invoiceDate: row.invoiceDate,
    code: row.code,
    note: row.note,
    isGasoline: row.isGasoline,
    photoUrl,
  };
}

const ticketFields = {
  store: z.string().trim().min(1).max(120),
  ticketDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  folio: z.string().trim().min(1).max(60),
  amount: z.number().positive().max(1000000),
  status: z.enum(["pendiente", "facturado"]),
  invoiceFolio: z.string().trim().max(80).nullable().optional(),
  invoiceDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable()
    .optional(),
  code: z.string().trim().max(80).nullable().optional(),
  note: z.string().trim().max(300).nullable().optional(),
  isGasoline: z.boolean(),
};

function clean(v: string | null | undefined): string | null {
  if (v == null) return null;
  const t = v.trim();
  return t === "" ? null : t;
}

function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

const SEED_TICKETS: Array<{
  store: string;
  ticketDate: string;
  folio: string;
  amount: number;
  status: "pendiente" | "facturado";
  invoiceFolio?: string;
  invoiceDate?: string;
  code?: string;
  note?: string;
  isGasoline: boolean;
}> = [
  // Sin tickets precargados: cada persona empieza con su propia lista vacía
  // y agrega sus tickets desde la app.
];

const SEED_PORTALS: Array<{
  name: string;
  url: string;
  username?: string;
  note?: string;
}> = [
  { name: "G500 FacturaGAS", url: "https://g500facturagas.azurewebsites.net/" },
  { name: "Hidrosina", url: "https://facturacionelectronica.hidrosina.com.mx" },
  { name: "PINFRA", url: "https://www.pinfrafacturacion.com.mx/" },
  { name: "Orujo", url: "http://orujo.gasolinamexico.net/facturacion_orujo/" },
];

export const Actions = {
  seedInitialData: defineAction({
    description:
      "Precarga una sola vez los portales de facturación comunes; no precarga tickets ni datos fiscales. Cada persona agrega los suyos desde la app; no hace nada si ya hay datos.",
    request: z.object({}),
    response: z.object({ seeded: z.boolean() }),
    async handler(ctx): Promise<{ seeded: boolean }> {
      const db = ctx.db<typeof schema>();
      const existing = await db
        .select({ id: schema.tickets.id })
        .from(schema.tickets)
        .limit(1);
      if (existing.length > 0) return { seeded: false };
      for (const t of SEED_TICKETS) {
        await db.insert(schema.tickets).values({
          store: t.store,
          ticketDate: t.ticketDate,
          folio: t.folio,
          amount: t.amount,
          status: t.status,
          invoiceFolio: t.invoiceFolio ?? null,
          invoiceDate: t.invoiceDate ?? null,
          code: t.code ?? null,
          note: t.note ?? null,
          isGasoline: t.isGasoline,
        });
      }
      // Sin perfil fiscal precargado: cada persona guarda el suyo desde la app.
      for (const p of SEED_PORTALS) {
        await db.insert(schema.portals).values({
          name: p.name,
          url: p.url,
          username: p.username ?? null,
          note: p.note ?? null,
        });
      }
      ctx.invalidateQueries();
      return { seeded: true };
    },
  }),

  listTickets: defineAction({
    description: "Lista todos los tickets, más recientes primero.",
    request: z.object({}),
    response: z.object({ tickets: z.array(ticketOut) }),
    async handler(ctx) {
      const db = ctx.db<typeof schema>();
      const rows = await db
        .select()
        .from(schema.tickets)
        .orderBy(desc(schema.tickets.ticketDate), desc(schema.tickets.id));
      const tickets = await Promise.all(rows.map((r) => toTicketOut(ctx, r)));
      return { tickets };
    },
  }),

  addTicket: defineAction({
    description: "Agrega un ticket nuevo y devuelve su id.",
    request: z.object({
      ...ticketFields,
      photoDataBase64: z.string().max(20000000).optional(),
      photoMimeType: z.string().max(60).optional(),
    }),
    response: z.object({ id: z.number() }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      let photoBlobKey: string | null = null;
      if (args.photoDataBase64) {
        const mime =
          args.photoMimeType === "image/png" ? "image/png" : "image/jpeg";
        photoBlobKey = `tickets/${Date.now()}-${Math.random()
          .toString(36)
          .slice(2, 10)}.${mime === "image/png" ? "png" : "jpg"}`;
        await ctx.blobs.put(photoBlobKey, base64ToBytes(args.photoDataBase64), {
          contentType: mime,
        });
      }
      const result = await db
        .insert(schema.tickets)
        .values({
          store: args.store,
          ticketDate: args.ticketDate,
          folio: args.folio,
          amount: args.amount,
          status: args.status,
          invoiceFolio: clean(args.invoiceFolio),
          invoiceDate: args.invoiceDate ?? null,
          code: clean(args.code),
          note: clean(args.note),
          isGasoline: args.isGasoline,
          photoBlobKey,
        })
        .returning({ id: schema.tickets.id });
      const inserted = result[0];
      if (!inserted) throw new Error("No se pudo guardar el ticket.");
      ctx.invalidateQueries();
      return { id: inserted.id };
    },
  }),

  updateTicket: defineAction({
    description: "Actualiza los datos de un ticket existente.",
    request: z.object({
      id: z.number().int().positive(),
      store: ticketFields.store.optional(),
      ticketDate: ticketFields.ticketDate.optional(),
      folio: ticketFields.folio.optional(),
      amount: ticketFields.amount.optional(),
      status: ticketFields.status.optional(),
      invoiceFolio: ticketFields.invoiceFolio,
      invoiceDate: ticketFields.invoiceDate,
      code: ticketFields.code,
      note: ticketFields.note,
      isGasoline: z.boolean().optional(),
    }),
    response: z.object({ ok: z.literal(true) }),
    async handler(ctx, args): Promise<{ ok: true }> {
      const db = ctx.db<typeof schema>();
      const patch: Partial<TicketRow> = {};
      if (args.store !== undefined) patch.store = args.store;
      if (args.ticketDate !== undefined) patch.ticketDate = args.ticketDate;
      if (args.folio !== undefined) patch.folio = args.folio;
      if (args.amount !== undefined) patch.amount = args.amount;
      if (args.status !== undefined) patch.status = args.status;
      if (args.invoiceFolio !== undefined)
        patch.invoiceFolio = clean(args.invoiceFolio);
      if (args.invoiceDate !== undefined)
        patch.invoiceDate = args.invoiceDate ?? null;
      if (args.code !== undefined) patch.code = clean(args.code);
      if (args.note !== undefined) patch.note = clean(args.note);
      if (args.isGasoline !== undefined) patch.isGasoline = args.isGasoline;
      await db
        .update(schema.tickets)
        .set(patch)
        .where(eq(schema.tickets.id, args.id));
      ctx.invalidateQueries();
      return { ok: true };
    },
  }),

  deleteTicket: defineAction({
    description: "Elimina un ticket por su id, junto con su foto si tiene.",
    request: z.object({ id: z.number().int().positive() }),
    response: z.object({ ok: z.literal(true) }),
    async handler(ctx, args): Promise<{ ok: true }> {
      const db = ctx.db<typeof schema>();
      const rows = await db
        .select()
        .from(schema.tickets)
        .where(eq(schema.tickets.id, args.id))
        .limit(1);
      const row = rows[0];
      if (row?.photoBlobKey) {
        try {
          await ctx.blobs.delete(row.photoBlobKey);
        } catch {
          // La foto es secundaria; el ticket se elimina de todos modos.
        }
      }
      await db.delete(schema.tickets).where(eq(schema.tickets.id, args.id));
      ctx.invalidateQueries();
      return { ok: true };
    },
  }),

  getFiscalProfile: defineAction({
    description: "Devuelve los datos fiscales guardados, o null si no hay.",
    request: z.object({}),
    response: z.object({
      profile: z
        .object({
          id: z.number(),
          name: z.string(),
          rfc: z.string(),
          regime: z.string(),
          postalCode: z.string(),
          email: z.string(),
          address: z.string(),
        })
        .nullable(),
    }),
    async handler(ctx) {
      const db = ctx.db<typeof schema>();
      const rows = await db
        .select()
        .from(schema.fiscalProfile)
        .orderBy(asc(schema.fiscalProfile.id))
        .limit(1);
      const row = rows[0];
      return {
        profile: row
          ? {
              id: row.id,
              name: row.name,
              rfc: row.rfc,
              regime: row.regime,
              postalCode: row.postalCode,
              email: row.email,
              address: row.address,
            }
          : null,
      };
    },
  }),

  updateFiscalProfile: defineAction({
    description: "Guarda los datos fiscales (nombre, RFC, régimen, CP, correo y domicilio).",
    request: z.object({
      name: z.string().trim().min(1).max(160),
      rfc: z.string().trim().min(1).max(20),
      regime: z.string().trim().min(1).max(160),
      postalCode: z.string().trim().min(1).max(10),
      email: z.string().trim().min(1).max(160),
      address: z.string().trim().min(1).max(400),
    }),
    response: z.object({ ok: z.literal(true) }),
    async handler(ctx, args): Promise<{ ok: true }> {
      const db = ctx.db<typeof schema>();
      const rows = await db
        .select({ id: schema.fiscalProfile.id })
        .from(schema.fiscalProfile)
        .limit(1);
      const first = rows[0];
      if (first) {
        await db
          .update(schema.fiscalProfile)
          .set(args)
          .where(eq(schema.fiscalProfile.id, first.id));
      } else {
        await db.insert(schema.fiscalProfile).values(args);
      }
      ctx.invalidateQueries();
      return { ok: true };
    },
  }),

  listPortals: defineAction({
    description: "Lista los portales de facturación guardados.",
    request: z.object({}),
    response: z.object({
      portals: z.array(
        z.object({
          id: z.number(),
          name: z.string(),
          url: z.string(),
          username: z.string().nullable(),
          note: z.string().nullable(),
        }),
      ),
    }),
    async handler(ctx) {
      const db = ctx.db<typeof schema>();
      const rows = await db
        .select()
        .from(schema.portals)
        .orderBy(asc(schema.portals.id));
      return {
        portals: rows.map((r) => ({
          id: r.id,
          name: r.name,
          url: r.url,
          username: r.username,
          note: r.note,
        })),
      };
    },
  }),

  addPortal: defineAction({
    description: "Agrega un portal de facturación (sin contraseñas).",
    request: z.object({
      name: z.string().trim().min(1).max(120),
      url: z.string().trim().min(1).max(400),
      username: z.string().trim().max(120).nullable().optional(),
      note: z.string().trim().max(300).nullable().optional(),
    }),
    response: z.object({ id: z.number() }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const result = await db
        .insert(schema.portals)
        .values({
          name: args.name,
          url: args.url,
          username: clean(args.username),
          note: clean(args.note),
        })
        .returning({ id: schema.portals.id });
      const inserted = result[0];
      if (!inserted) throw new Error("No se pudo guardar el portal.");
      ctx.invalidateQueries();
      return { id: inserted.id };
    },
  }),

  deletePortal: defineAction({
    description: "Elimina un portal de facturación por su id.",
    request: z.object({ id: z.number().int().positive() }),
    response: z.object({ ok: z.literal(true) }),
    async handler(ctx, args): Promise<{ ok: true }> {
      const db = ctx.db<typeof schema>();
      await db.delete(schema.portals).where(eq(schema.portals.id, args.id));
      ctx.invalidateQueries();
      return { ok: true };
    },
  }),
} satisfies ActionsModule;
