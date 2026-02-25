const mongoose = require("mongoose");

const userSchema = new mongoose.Schema(
  {
    fullName: {
      type: String,
      required: true,
      trim: true,
    },

    username: {
      type: String,
      unique: true,
      sparse: true,
      trim: true,
    },

    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },

    phone: {
      type: String,
      required: true,
      trim: true,
    },

    password: {
      type: String,
      required: true,
    },

    companyName: {
      type: String,
      trim: true,
    },

    companyType: {
      type: String,
      trim: true,
    },

    // KYC Details
    kyc: {
      isCompleted: {
        type: Boolean,
        default: false,
      },
      status: {
        type: String,
        enum: ["not_submitted", "pending", "approved", "rejected"],
        default: "not_submitted",
      },
      rejectionReason: { type: String },
      aadhar: {
        number: { type: String },
        frontImage: { type: String },
        backImage: { type: String },
      },
      pan: {
        number: { type: String },
        image: { type: String },
      },
      bank: {
        accountNumber: { type: String },
        ifscCode: { type: String },
        bankName: { type: String },
        accountHolderName: { type: String },
      },
      submittedAt: { type: Date },
      approvedAt: { type: Date },
    },

    // Profile Image
    profileImage: {
      type: String,
      default: ""
    },

    // Uploaded Documents (legacy)
    aadharFile: {
      type: String,
    },

    panFile: {
      type: String,
    },

    udyamFile: {
      type: String,
    },

    cinFile: {
      type: String,
    },

    // Wallet Balance
    balance: {
      type: Number,
      default: 0,
    },

    // Role (Admin / User)
    role: {
      type: String,
      enum: ["user", "admin"],
      default: "user",
    },
    status: {
      type: String,
      enum: ["Active", "Suspended"],
      default: "Active",
    },

    // API Tokens
    apiTokens: [{
      name: { type: String, required: true },
      keyId: { type: String, required: true },
      secretKey: { type: String, required: true },
      mode: { type: String, enum: ["test", "live"], default: "test" },
      status: { type: String, enum: ["active", "revoked"], default: "active" },
      createdAt: { type: Date, default: Date.now }
    }],

    // Password Reset
    resetPasswordToken: {
      type: String,
    },
    resetPasswordExpires: {
      type: Date,
    },

  },
  { timestamps: true }
);

// Remove password when sending user data
userSchema.methods.toJSON = function () {
  const user = this.toObject();
  delete user.password;
  return user;
};

module.exports = mongoose.model("User", userSchema);
