# Facturas y Tickets

App para llevar el control de tickets de compra y su facturación (CFDI) en México: registra tickets con foto, marca los ya facturados, guarda tus datos fiscales y los portales de facturación que usas.

## Qué hace

- Registrar tickets con tienda, fecha, folio, monto, foto y código de facturación.
- Marcar tickets como pendientes o facturados, con folio y fecha de factura.
- Guardar un perfil fiscal (nombre, RFC, régimen, CP, correo y domicilio) y usarlo al facturar.
- Guardar portales de facturación (nombre, enlace y usuario, sin contraseñas).
- Resumen mensual, filtros por pendiente/facturado y búsqueda por tienda o folio.
- Las fotos de tickets tomadas con iPhone (HEIC) se convierten a JPEG automáticamente.

## Cómo se instala

> Esta app está hecha para correr dentro de Muse (usa `@hatch/space-sdk` y el
> runtime de espacios de Muse: base de datos y almacenamiento de fotos
> gestionados por la plataforma). Tal como está, **no es instalable con un
> solo clic fuera de Muse**: para correrla por tu cuenta hay que adaptar el
> servidor (`server/src/actions.ts`) a un servidor Bun + SQLite propio y el
> cliente (`client/src/api.ts`) a ese servidor.

Si la corres dentro de Muse, basta con crear el espacio a partir de este
código: el espacio se encarga de la base de datos (SQLite con Drizzle) y del
almacenamiento de fotos.

### Requisitos (para desarrollo)

- [Bun](https://bun.sh) 1.3 o superior
- Node no es necesario si usas Bun

### Comandos

```bash
bun install
bun run typecheck   # revisa tipos del cliente y del servidor
bun run build       # compila servidor y cliente
```

## Estructura

```
client/            App en React (interfaz)
  src/App.tsx      Pantallas: lista de tickets, detalle, perfil fiscal, portales
  src/api.ts       Cliente tipado de las acciones del servidor
server/
  src/actions.ts   Acciones: tickets, perfil fiscal y portales
  src/schema.ts    Tablas (Drizzle + SQLite)
drizzle/           Migraciones de la base de datos
space.json         Configuración del espacio en Muse
```

## Datos

La app **no trae tickets ni datos fiscales precargados**: cada persona empieza
con su lista vacía y agrega los suyos. Los datos quedan en su propia base de
datos; este repositorio solo guarda el código.
