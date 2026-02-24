import { envConfig } from "../lib/config";
import sgMail from "@sendgrid/mail";



export const otpTemp = (OTP: string) => `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>OTP Verification</title>
    <style>
        body {
            font-family: Arial, sans-serif;
            line-height: 1.6;
            color: #333;
            max-width: 600px;
            margin: 0 auto;
            padding: 20px;
            background-color: #f4f4f4;
        }
        .container {
            background-color: #ffffff;
            padding: 30px;
            border-radius: 10px;
            box-shadow: 0 2px 10px rgba(0,0,0,0.1);
        }
        .header {
            text-align: center;
            margin-bottom: 30px;
        }
        .logo {
            font-size: 24px;
            font-weight: bold;
            color: #2c3e50;
        }
        .otp-code {
            background-color: #f8f9fa;
            border: 2px dashed #007bff;
            padding: 20px;
            text-align: center;
            margin: 20px 0;
            border-radius: 8px;
        }
        .otp-number {
            font-size: 32px;
            font-weight: bold;
            color: #007bff;
            letter-spacing: 5px;
        }
        .message {
            text-align: center;
            margin: 20px 0;
        }
        .warning {
            background-color: #fff3cd;
            border: 1px solid #ffeaa7;
            padding: 15px;
            border-radius: 5px;
            margin: 20px 0;
            color: #856404;
        }
        .footer {
            text-align: center;
            margin-top: 30px;
            color: #666;
            font-size: 14px;
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <div class="logo">Your App Name</div>
        </div>
        
        <div class="message">
            <h2>OTP Verification</h2>
            <p>Your One-Time Password (OTP) for verification is:</p>
        </div>
        
        <div class="otp-code">
            <div class="otp-number">${OTP}</div>
        </div>
        
        <div class="message">
            <p>This OTP will expire in <strong>10 minutes</strong>.</p>
            <p>Please enter this code to complete your verification process.</p>
        </div>
        
        <div class="warning">
            <strong>Security Notice:</strong> Never share this OTP with anyone. Our team will never ask for your OTP.
        </div>
        
        <div class="footer">
            <p>If you didn't request this OTP, please ignore this email.</p>
            <p>© 2024 Your App Name. All rights reserved.</p>
        </div>
    </div>
</body>
</html>
`

export const welcomeTemp = (email: string, password: string) => `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Welcome to CallScout</title>
    <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #f4f4f4; }
        .container { background-color: #ffffff; padding: 30px; border-radius: 10px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
        .header { text-align: center; margin-bottom: 30px; }
        .logo { font-size: 24px; font-weight: bold; color: #2c3e50; }
        .details-box { background: #f8f9fa; border: 2px dashed #28a745; padding: 20px; border-radius: 8px; margin: 20px 0; text-align: center; }
        .message { margin: 20px 0; }
        .footer { text-align: center; margin-top: 30px; color: #666; font-size: 14px; }
        .credential { margin: 10px 0; font-size: 18px; }
        .label { font-weight: bold; color: #555; }
    </style>
</head>
<body>
    <div class="container">
        <div class="header"><div class="logo">CallScout</div></div>
        <div class="message">
            <h2>Welcome to CallScout!</h2>
            <p>Your account has been successfully created. Here are your login details:</p>
        </div>
        <div class="details-box">
            <div class="credential"><span class="label">Email:</span> ${email}</div>
            <div class="credential"><span class="label">Password:</span> ${password}</div>
        </div>
        <div class="message">
            <p>Please login and change your password after your first login.</p>
        </div>
        <div class="footer"><p>© 2026 CallScout. All rights reserved.</p></div>
    </div>
</body>
</html>
`

export const sendEmail = async (to: string, subject: string, html: string) => {
  try {
    const msg = {
      to,
      from: envConfig.EMAIL_USER as string,
      subject,
      html,
    };
    await sgMail.send(msg);
  }
  catch (error) {
    console.log("Error sending email:", error);
    return {error};
  }
}