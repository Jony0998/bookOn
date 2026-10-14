export enum HttpCode {
  OK = 200,
  CREATED = 201,
  NOT_MODIFIED = 304,
  BAD_REQUEST = 400,
  UNAUTHORIZED = 401,
  FORBIDDEN = 403,
  NOT_FOUND = 404,
  INTERNAL_SERVER_ERROR = 500,
}

export enum Message {
  SOMETHING_WENT_WRONG = "Something went wrong!",
  NO_DATA_FOUND = "No data is found!",
  CREATE_FAILED = "Create is failed!",
  LIBRARY_ALREADY_EXISTS = "Only one library is allowed. A library is already registered.",
  UPDATE_FAILED = "Update is  failed",
  BLOCKED_USER = "You have been blocked! Please contact the library.",
  NO_MEMBER_NICK = "No Member with that member Nick!",

  USED_NICK_PHONE = "You are inserting already used nick or phone!",
  TOKEN_CREATION_FAILED = "Token creation error!",
  WRONG_PASSWORD = "Wrong password!",
  NOT_AUTHENTICATED = "You are not authenticated , Please login first",
  INVALID_INPUT = "Invalid input provided!",
  INVALID_FILE = "Only jpg, jpeg, png and webp images up to 5MB are allowed!",
  INVALID_STATUS_CHANGE = "This order status change is not allowed!",
}

class Errors extends Error {
  public code: HttpCode;
  public message: Message;

  static standard = {
    code: HttpCode.INTERNAL_SERVER_ERROR,
    message: Message.SOMETHING_WENT_WRONG,
  };

  constructor(statusCode: HttpCode, statusMessage: Message) {
    super();
    this.code = statusCode;
    this.message = statusMessage;
  }
}

export default Errors;
