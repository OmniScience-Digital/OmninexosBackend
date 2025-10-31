import "dotenv/config";
import "./index.js";
// Determine server environment we're working on
if (process.env.NODE_ENV === "development") {
    import("./crons/dev/dev.env.js");
}
else {
    import("./crons/prod/index.prod.js");
}
