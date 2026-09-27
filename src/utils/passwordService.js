const nodemailer = require('nodemailer');

// Mailtrap configuration
const transporter = nodemailer.createTransport({
  host: process.env.MAILTRAP_HOST || "sandbox.smtp.mailtrap.io",
  port: process.env.MAILTRAP_PORT || 2525,
  auth: {
    user: process.env.MAILTRAP_USER,
    pass: process.env.MAILTRAP_PASSWORD,
  },
});

/**
 * Send password reset email with reset code
 * @param {string} email - User's email address
 * @param {string} fullName - User's full name
 * @param {string} code - 6-digit reset code
 */
const sendResetPasswordEmail = async (email, fullName, code) => {
  try {
    const resetLink = `${process.env.FRONTEND_URL || "http://localhost:3000"}/reset-password?email=${encodeURIComponent(email)}&code=${code}`;

    const htmlContent = `
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <style>
          body {
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            line-height: 1.6;
            color: #333;
            background-color: #f9f9f9;
          }
          .email-container {
            max-width: 600px;
            margin: 0 auto;
            background-color: #ffffff;
            border-radius: 8px;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
            overflow: hidden;
          }
          .header {
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            padding: 40px 20px;
            text-align: center;
          }
          .header h1 {
            margin: 0;
            font-size: 28px;
            font-weight: 600;
          }
          .content {
            padding: 40px;
          }
          .greeting {
            font-size: 16px;
            margin-bottom: 20px;
            color: #555;
          }
          .message {
            font-size: 14px;
            color: #666;
            margin-bottom: 30px;
            line-height: 1.8;
          }
          .code-section {
            background-color: #f5f5f5;
            border-left: 4px solid #667eea;
            padding: 20px;
            margin: 30px 0;
            border-radius: 4px;
            text-align: center;
          }
          .reset-code {
            font-size: 36px;
            font-weight: bold;
            color: #667eea;
            letter-spacing: 3px;
            margin: 20px 0;
            font-family: 'Courier New', monospace;
          }
          .code-expiry {
            font-size: 12px;
            color: #999;
            margin-top: 15px;
          }
          .button-container {
            text-align: center;
            margin: 30px 0;
          }
          .reset-button {
            display: inline-block;
            background-color: #667eea;
            color: white;
            padding: 12px 40px;
            text-decoration: none;
            border-radius: 6px;
            font-weight: 600;
            font-size: 16px;
            transition: background-color 0.3s ease;
          }
          .reset-button:hover {
            background-color: #5568d3;
          }
          .security-note {
            background-color: #fff3cd;
            border: 1px solid #ffc107;
            color: #856404;
            padding: 15px;
            border-radius: 4px;
            font-size: 13px;
            margin-top: 30px;
          }
          .footer {
            background-color: #f9f9f9;
            border-top: 1px solid #eee;
            padding: 20px;
            text-align: center;
            font-size: 12px;
            color: #999;
          }
          .footer a {
            color: #667eea;
            text-decoration: none;
          }
        </style>
      </head>
      <body>
        <div class="email-container">
          <div class="header">
            <h1>🔐 Reset Your Password</h1>
          </div>
          <div class="content">
            <div class="greeting">
              Hi ${fullName},
            </div>
            <div class="message">
              We received a request to reset the password for your account. If you didn't make this request, you can safely ignore this email.
            </div>
            <div class="code-section">
              <div style="font-size: 14px; color: #666; margin-bottom: 10px;">Your Password Reset Code</div>
              <div class="reset-code">${code}</div>
              <div class="code-expiry">This code expires in 15 minutes</div>
            </div>
            <div class="button-container">
              <a href="${resetLink}" class="reset-button">Reset Password</a>
            </div>
            <div style="margin-top: 20px; font-size: 14px; color: #666;">
              Or enter this code on the reset password page:
              <div style="background-color: #f5f5f5; padding: 15px; margin-top: 10px; border-radius: 4px; font-family: 'Courier New', monospace; font-weight: bold; color: #667eea;">
                ${code}
              </div>
            </div>
            <div class="security-note">
              ⚠️ <strong>Security Tip:</strong> Never share your reset code with anyone. Our team will never ask you for your password reset code. If you didn't request this password reset, please secure your account immediately by contacting our support team.
            </div>
          </div>
          <div class="footer">
            <p style="margin: 0;">© 2024 AfriMarket. All rights reserved.</p>
            <p style="margin: 10px 0 0 0;">
              <a href="${process.env.FRONTEND_URL || "http://localhost:3000"}/help">Need Help?</a> |
              <a href="${process.env.FRONTEND_URL || "http://localhost:3000"}/contact">Contact Support</a>
            </p>
          </div>
        </div>
      </body>
      </html>
    `;

    const mailOptions = {
      from: process.env.MAILTRAP_FROM_EMAIL || "noreply@afrimarket.com",
      to: email,
      subject: "Password Reset Request - Action Required",
      html: htmlContent,
      text: `Hi ${fullName},\n\nWe received a request to reset your password. Your password reset code is: ${code}\n\nThis code expires in 15 minutes.\n\nIf you didn't request this, please ignore this email.\n\nReset Link: ${resetLink}`,
    };

    await transporter.sendMail(mailOptions);
    return { success: true, message: "Reset email sent successfully" };
  } catch (error) {
    console.error("Error sending reset password email:", error);
    throw new Error("Failed to send reset password email");
  }
};

/**
 * Send password change confirmation email
 * @param {string} email - User's email address
 * @param {string} fullName - User's full name
 */
const sendPasswordChangeConfirmation = async (email, fullName) => {
  try {
    const htmlContent = `
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <style>
          body {
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            line-height: 1.6;
            color: #333;
            background-color: #f9f9f9;
          }
          .email-container {
            max-width: 600px;
            margin: 0 auto;
            background-color: #ffffff;
            border-radius: 8px;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
            overflow: hidden;
          }
          .header {
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            padding: 40px 20px;
            text-align: center;
          }
          .header h1 {
            margin: 0;
            font-size: 28px;
            font-weight: 600;
          }
          .content {
            padding: 40px;
          }
          .greeting {
            font-size: 16px;
            margin-bottom: 20px;
            color: #555;
          }
          .message {
            font-size: 14px;
            color: #666;
            margin-bottom: 20px;
            line-height: 1.8;
          }
          .success-icon {
            text-align: center;
            font-size: 48px;
            margin: 20px 0;
          }
          .security-info {
            background-color: #d4edda;
            border: 1px solid #28a745;
            color: #155724;
            padding: 15px;
            border-radius: 4px;
            font-size: 13px;
            margin-top: 30px;
          }
          .footer {
            background-color: #f9f9f9;
            border-top: 1px solid #eee;
            padding: 20px;
            text-align: center;
            font-size: 12px;
            color: #999;
          }
          .footer a {
            color: #667eea;
            text-decoration: none;
          }
        </style>
      </head>
      <body>
        <div class="email-container">
          <div class="header">
            <h1>✓ Password Changed Successfully</h1>
          </div>
          <div class="content">
            <div class="greeting">
              Hi ${fullName},
            </div>
            <div class="success-icon">✅</div>
            <div class="message">
              Your password has been successfully changed. You can now log in with your new password.
            </div>
            <div class="security-info">
              💡 <strong>Security Notice:</strong> If you didn't make this change, please contact our support team immediately to secure your account.
            </div>
          </div>
          <div class="footer">
            <p style="margin: 0;">© 2024 AfriMarket. All rights reserved.</p>
            <p style="margin: 10px 0 0 0;">
              <a href="${process.env.FRONTEND_URL || "http://localhost:3000"}/help">Need Help?</a> |
              <a href="${process.env.FRONTEND_URL || "http://localhost:3000"}/contact">Contact Support</a>
            </p>
          </div>
        </div>
      </body>
      </html>
    `;

    const mailOptions = {
      from: process.env.MAILTRAP_FROM_EMAIL || "noreply@afrimarket.com",
      to: email,
      subject: "Password Changed Successfully",
      html: htmlContent,
      text: `Hi ${fullName},\n\nYour password has been successfully changed. If you didn't make this change, please contact support immediately.`,
    };

    await transporter.sendMail(mailOptions);
    return { success: true, message: "Confirmation email sent successfully" };
  } catch (error) {
    console.error("Error sending password change confirmation:", error);
    throw new Error("Failed to send confirmation email");
  }
};

module.exports = {
  sendResetPasswordEmail,
  sendPasswordChangeConfirmation,
};