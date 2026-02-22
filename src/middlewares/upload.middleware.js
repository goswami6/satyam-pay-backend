const multer = require("multer");
const path = require("path");
const fs = require("fs");

// ✅ Use absolute path for uploads directory
const uploadsPath = path.join(__dirname, "../../uploads");

// ✅ Create uploads directory if it doesn't exist
if (!fs.existsSync(uploadsPath)) {
  fs.mkdirSync(uploadsPath, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadsPath);
  },
  filename: (req, file, cb) => {
    cb(
      null,
      Date.now() + "-" + file.fieldname + path.extname(file.originalname)
    );
  },
});

const upload = multer({ storage });

module.exports = upload;
