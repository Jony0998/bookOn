import multer from "multer";
import { v4 } from "uuid"; // check dock v5
import Errors, { HttpCode, Message } from "../types/Errors";

/**MULTER IMAGE UPLOADER */

// Extension is derived from the validated mimetype, never from the client file name
const ALLOWED_IMAGE_TYPES: Record<string, string> = {
  "image/jpeg": ".jpg",
  "image/jpg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
};
const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB

function getTargetImageStorage(adress: string) {
  return multer.diskStorage({
    destination: function (req, file, cb) {
      cb(null, `./uploads/${adress}`);
    },
    filename: function (req, file, cb) {
      cb(null, v4() + ALLOWED_IMAGE_TYPES[file.mimetype]);
    },
  });
}

const makeUploader = (adress: string) => {
  const storage = getTargetImageStorage(adress);
  return multer({
    storage: storage,
    limits: { fileSize: MAX_FILE_SIZE, files: 5 },
    fileFilter: (req, file, cb) => {
      if (ALLOWED_IMAGE_TYPES[file.mimetype]) cb(null, true);
      else cb(new Errors(HttpCode.BAD_REQUEST, Message.INVALID_FILE));
    },
  });
};

export default makeUploader;
