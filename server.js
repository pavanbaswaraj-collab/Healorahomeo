const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || "0.0.0.0";
const PUBLIC_DIR = path.join(__dirname, "public");
const DATA_DIR = path.join(__dirname, "data");
const BOOKINGS_FILE = path.join(DATA_DIR, "bookings.json");

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp"
};

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8"
  });
  response.end(JSON.stringify(payload));
}

function sendRedirect(response, location) {
  response.writeHead(302, {
    Location: location
  });
  response.end();
}

function ensureDataStore() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }

  if (!fs.existsSync(BOOKINGS_FILE)) {
    fs.writeFileSync(BOOKINGS_FILE, "[]", "utf8");
  }
}

function parseBody(request) {
  return new Promise((resolve, reject) => {
    let body = "";

    request.on("data", (chunk) => {
      body += chunk.toString();

      if (body.length > 1_000_000) {
        reject(new Error("Request body too large"));
        request.destroy();
      }
    });

    request.on("end", () => {
      if (!body) {
        resolve({});
        return;
      }

      try {
        const contentType = request.headers["content-type"] || "";

        if (contentType.includes("application/json")) {
          resolve(JSON.parse(body));
          return;
        }

        if (contentType.includes("application/x-www-form-urlencoded")) {
          const params = new URLSearchParams(body);
          resolve(Object.fromEntries(params.entries()));
          return;
        }

        resolve(JSON.parse(body));
      } catch (error) {
        reject(new Error("Invalid JSON payload"));
      }
    });

    request.on("error", reject);
  });
}

function validateBooking(payload) {
  const booking = {
    name: String(payload.name || "").trim(),
    phone: String(payload.phone || "").trim(),
    email: String(payload.email || "").trim(),
    concern: String(payload.concern || "").trim(),
    preferredDate: String(payload.preferredDate || "").trim(),
    consultationMode: String(payload.consultationMode || "").trim(),
    message: String(payload.message || "").trim()
  };

  if (!booking.name || !booking.phone || !booking.concern) {
    return {
      ok: false,
      message: "Name, phone number, and health concern are required."
    };
  }

  return {
    ok: true,
    booking
  };
}

function readBookings() {
  ensureDataStore();
  return JSON.parse(fs.readFileSync(BOOKINGS_FILE, "utf8"));
}

function saveBooking(booking) {
  const bookings = readBookings();
  bookings.push(booking);
  fs.writeFileSync(BOOKINGS_FILE, JSON.stringify(bookings, null, 2), "utf8");
}

function createBookingRecord(payload) {
  const result = validateBooking(payload);

  if (!result.ok) {
    return result;
  }

  const booking = {
    id: Date.now().toString(),
    createdAt: new Date().toISOString(),
    ...result.booking
  };

  saveBooking(booking);

  return {
    ok: true,
    booking
  };
}

function serveFile(requestPath, response) {
  const safePath = requestPath === "/" ? "/index.html" : requestPath;
  const normalized = path.normalize(safePath).replace(/^(\.\.[/\\])+/, "");
  const filePath = path.join(PUBLIC_DIR, normalized);

  if (!filePath.startsWith(PUBLIC_DIR)) {
    sendJson(response, 403, { message: "Forbidden" });
    return;
  }

  fs.readFile(filePath, (error, content) => {
    if (error) {
      if (error.code === "ENOENT") {
        sendJson(response, 404, { message: "Not found" });
        return;
      }

      sendJson(response, 500, { message: "Server error" });
      return;
    }

    const extension = path.extname(filePath).toLowerCase();
    response.writeHead(200, {
      "Content-Type": MIME_TYPES[extension] || "application/octet-stream"
    });
    response.end(content);
  });
}

ensureDataStore();

const server = http.createServer(async (request, response) => {
  const requestUrl = new URL(request.url, `http://${request.headers.host}`);
  const bookingSubmissionPaths = new Set(["/", "/booking", "/index.html", "/api/bookings"]);

  if (request.method === "OPTIONS") {
    response.writeHead(204, {
      Allow: "GET, POST, OPTIONS"
    });
    response.end();
    return;
  }

  if (request.method === "GET" && requestUrl.pathname === "/booking") {
    sendRedirect(response, "/#booking");
    return;
  }

  if (request.method === "GET" && requestUrl.pathname === "/api/health") {
    sendJson(response, 200, {
      status: "ok",
      site: "Heal Ora Homoeopathy Clinic"
    });
    return;
  }

  if (request.method === "GET" && requestUrl.pathname === "/api/bookings") {
    const bookings = readBookings();
    sendJson(response, 200, {
      count: bookings.length,
      bookings
    });
    return;
  }

  if (request.method === "POST" && bookingSubmissionPaths.has(requestUrl.pathname)) {
    try {
      const payload = await parseBody(request);

      if (
        requestUrl.pathname !== "/api/bookings" &&
        payload["form-name"] &&
        payload["form-name"] !== "booking-request"
      ) {
        sendJson(response, 400, { message: "Unknown form submission." });
        return;
      }

      const result = createBookingRecord(payload);

      if (!result.ok) {
        sendJson(response, 400, { message: result.message });
        return;
      }

      sendJson(response, 201, {
        message: "Booking submitted successfully.",
        booking: result.booking
      });
    } catch (error) {
      sendJson(response, 400, { message: error.message });
    }

    return;
  }

  if (request.method === "GET") {
    serveFile(requestUrl.pathname, response);
    return;
  }

  sendJson(response, 405, { message: "Method not allowed" });
});

server.on("error", (error) => {
  if (error.code === "EADDRINUSE") {
    console.error(
      `Port ${PORT} is already in use. Close the existing server or run with a different port, for example: $env:PORT=3001; node server.js`
    );
    process.exit(1);
  }

  console.error("Server failed to start:", error.message);
  process.exit(1);
});

server.listen(PORT, HOST, () => {
  console.log(`Heal Ora running at http://localhost:${PORT}`);
});
