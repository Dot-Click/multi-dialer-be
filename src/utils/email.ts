import { envConfig } from "../lib/config";
import { emailFooter } from "./emailFooter";
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
        ${emailFooter()}
</body>
</html>
`

export const welcomeTemp = (email: string, setPasswordUrl: string) => `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Welcome to Slingvo</title>
    <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #f4f4f4; }
        .container { background-color: #ffffff; padding: 30px; border-radius: 10px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
        .header { text-align: center; margin-bottom: 30px; }
        .logo { font-size: 24px; font-weight: bold; color: #2c3e50; }
        .details-box { background: #f8f9fa; border: 2px dashed #28a745; padding: 20px; border-radius: 8px; margin: 20px 0; text-align: center; }
        .message { margin: 20px 0; }
        .footer { text-align: center; margin-top: 30px; color: #666; font-size: 14px; }
        .button { display: inline-block; background: #FFCA06; color: #1a1a1a; padding: 14px 32px; border-radius: 8px; text-decoration: none; font-size: 16px; font-weight: bold; }
    </style>
</head>
<body>
    <div class="container">
        <div class="message">
            <h2>Welcome to Slingvo!</h2>
            <p>Your account has been successfully created. To activate it, choose a password using the button below.</p>
        </div>
        <div class="details-box">
            <p style="margin:0;font-size:15px;"><strong>Email:</strong> ${email}</p>
        </div>
        <div style="text-align:center;margin:30px 0"><a href="${setPasswordUrl}" class="button">Set Password</a></div>
        <div class="message">
            <p style="font-size:13px;color:#666;">This link is single-use and stops working the moment you set your password. If you didn't expect this email, please ignore it.</p>
        </div>
        <div class="footer"><p>© 2026 Slingvo. All rights reserved.</p></div>
    </div>
        ${emailFooter()}
</body>
</html>
`

export const leadSheetEmailTemp = (contactName: string, leadSheetTitle: string, questions: { text: string, answer: any }[]) => `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Lead Sheet: ${leadSheetTitle}</title>
    <style>
        body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; line-height: 1.6; color: #333; max-width: 700px; margin: 0 auto; padding: 20px; background-color: #f9fafb; }
        .container { background-color: #ffffff; padding: 40px; border-radius: 12px; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06); }
        .header { border-bottom: 2px solid #e5e7eb; margin-bottom: 30px; padding-bottom: 20px; }
        .title { font-size: 24px; font-weight: 700; color: #111827; margin: 0; }
        .subtitle { font-size: 16px; color: #6b7280; margin-top: 5px; }
        .question-block { margin-bottom: 25px; padding: 15px; background: #fdfdfd; border: 1px solid #f3f4f6; border-radius: 8px; }
        .question-text { font-weight: 600; color: #374151; margin-bottom: 8px; font-size: 15px; }
        .answer-text { color: #1f2937; background: #fff; padding: 10px; border-radius: 6px; border-left: 4px solid #3b82f6; font-size: 15px; }
        .no-answer { font-style: italic; color: #9ca3af; }
        .footer { text-align: center; margin-top: 40px; color: #9ca3af; font-size: 13px; }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1 class="title">${leadSheetTitle}</h1>
            <p class="subtitle">Contact: <strong>${contactName}</strong></p>
        </div>
        
        <div class="content">
            ${questions.map(q => `
                <div class="question-block">
                    <div class="question-text">${q.text}</div>
                    <div class="answer-text">
                        ${q.answer ? (Array.isArray(q.answer) ? q.answer.join(', ') : q.answer) : '<span class="no-answer">No answer provided</span>'}
                    </div>
                </div>
            `).join('')}
        </div>
        
        <div class="footer">
            <p>Sent via Slingvo</p>
            <p>© 2026 All rights reserved.</p>
        </div>
    </div>
        ${emailFooter()}
</body>
</html>
`

export const newUserSignupTemp = (userEmail: string, signupTime: string) => `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>New User Signup on Slingvo</title>
    <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #f4f4f4; }
        .container { background-color: #ffffff; padding: 30px; border-radius: 10px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
        .header { text-align: center; margin-bottom: 30px; }
        .logo { font-size: 24px; font-weight: bold; color: #2c3e50; }
        .info { background: #f8f9fa; border: 2px dashed #28a745; padding: 20px; border-radius: 8px; margin: 20px 0; }
        .footer { text-align: center; margin-top: 30px; color: #666; font-size: 14px; }
    </style>
</head>
<body>
    <div class="container">
        <h2 style="color: #2c3e50;">New User Signup Notification</h2>
        <p>A new user has signed up on Slingvo.</p>
        <div class="info">
            <p style="margin:5px 0;"><strong>Email:</strong> ${userEmail}</p>
            <p style="margin:5px 0;"><strong>Signup Time:</strong> ${signupTime}</p>
        </div>
        <div class="footer"><p>© 2026 Slingvo. All rights reserved.</p></div>
    </div>
        ${emailFooter()}
</body>
</html>
`

export const loginAlertTemp = (userEmail: string, loginTime: string) => `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>User Login Alert - Slingvo</title>
    <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #f4f4f4; }
        .container { background-color: #ffffff; padding: 30px; border-radius: 10px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
        .header { text-align: center; margin-bottom: 30px; }
        .logo { font-size: 24px; font-weight: bold; color: #2c3e50; }
        .info { background: #f8f9fa; border: 2px dashed #FFCA06; padding: 20px; border-radius: 8px; margin: 20px 0; }
        .footer { text-align: center; margin-top: 30px; color: #666; font-size: 14px; }
    </style>
</head>
<body>
    <div class="container">
        <h2 style="color: #2c3e50;">User Login Alert</h2>
        <p>A user has logged in to Slingvo.</p>
        <div class="info">
            <p style="margin:5px 0;"><strong>Account:</strong> ${userEmail}</p>
            <p style="margin:5px 0;"><strong>Login Time:</strong> ${loginTime}</p>
        </div>
        <div class="footer"><p>© 2026 Slingvo. All rights reserved.</p></div>
    </div>
        ${emailFooter()}
</body>
</html>
`

export const emailChangeConfirmationTemp = (fullName: string, oldEmail: string, newEmail: string, confirmUrl: string) => `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Confirm Your New Email - Slingvo</title>
    <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #f4f4f4; }
        .container { background-color: #ffffff; padding: 30px; border-radius: 10px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
        .header { text-align: center; margin-bottom: 30px; }
        .logo { font-size: 24px; font-weight: bold; color: #2c3e50; }
        .details-box { background: #f8f9fa; border: 2px dashed #28a745; padding: 20px; border-radius: 8px; margin: 20px 0; }
        .details-row { margin: 6px 0; font-size: 15px; }
        .message { margin: 20px 0; }
        .footer { text-align: center; margin-top: 30px; color: #666; font-size: 14px; }
        .button { display: inline-block; background: #FFCA06; color: #1a1a1a; padding: 14px 32px; border-radius: 8px; text-decoration: none; font-size: 16px; font-weight: bold; }
    </style>
</head>
<body>
    <div class="container">
        <div class="message">
            <h2 style="color: #2c3e50;">Confirm your email change</h2>
            <p>Hi ${fullName},</p>
            <p>You requested to change the email address on your Slingvo account. Click below to confirm — until you do, your account keeps using the current address.</p>
        </div>
        <div class="details-box">
            <div class="details-row"><strong>Current:</strong> ${oldEmail}</div>
            <div class="details-row"><strong>New:</strong> ${newEmail}</div>
        </div>
        <div style="text-align:center; margin: 30px 0;">
            <a href="${confirmUrl}" class="button">Confirm Email Change</a>
        </div>
        <p style="font-size:14px;color:#666;">If you didn't request this, you can safely ignore this email — no change will be made.</p>
        <div class="footer"><p>© 2026 Slingvo. All rights reserved.</p></div>
    </div>
        ${emailFooter()}
</body>
</html>
`

export const emailVerificationTemp = (fullName: string, email: string, password: string, loginUrl: string) => `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Your Slingvo Account Details</title>
    <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #f4f4f4; }
        .container { background-color: #ffffff; padding: 30px; border-radius: 10px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
        .header { text-align: center; margin-bottom: 30px; }
        .logo { font-size: 24px; font-weight: bold; color: #2c3e50; }
        .credentials { background: #f8f9fa; border: 2px dashed #28a745; padding: 20px; border-radius: 8px; margin: 20px 0; }
        .cred-row { margin: 6px 0; font-size: 15px; }
        .message { margin: 20px 0; }
        .footer { text-align: center; margin-top: 30px; color: #666; font-size: 14px; }
        .button { display: inline-block; background: #FFCA06; color: #1a1a1a; padding: 14px 32px; border-radius: 8px; text-decoration: none; font-size: 16px; font-weight: bold; }
    </style>
</head>
<body>
    <div class="container">
        <div class="message">
            <h2 style="color: #2c3e50;">Welcome to Slingvo!</h2>
            <p>Hi ${fullName || "there"},</p>
            <p>Your account has been successfully created. Here are your login details:</p>
        </div>
        <div class="credentials">
            <div class="cred-row"><strong>Email:</strong> ${email}</div>
            <div class="cred-row"><strong>Password:</strong> ${password}</div>
        </div>
        <p style="font-size:14px;color:#666;">Please log in and change your password after your first sign-in.</p>
        <div style="text-align:center; margin: 30px 0;">
            <a href="${loginUrl}" class="button">Log In Now</a>
        </div>
        <div class="footer"><p>© 2026 Slingvo. All rights reserved.</p></div>
    </div>
        ${emailFooter()}
</body>
</html>
`

// ── Admin / lifecycle notification templates ──────────────────────────────────

export const memberAddedTemp = (adminName: string, agentName: string, agentEmail: string) => `
<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><title>Member Added - Slingvo</title>
<style>body{font-family:Arial,sans-serif;line-height:1.6;color:#333;max-width:600px;margin:0 auto;padding:20px;background:#f4f4f4}.container{background:#fff;padding:30px;border-radius:10px;box-shadow:0 2px 10px rgba(0,0,0,.1)}.logo{font-size:24px;font-weight:bold;color:#2c3e50;text-align:center;margin-bottom:30px}.info{background:#f8f9fa;border:2px dashed #28a745;padding:20px;border-radius:8px;margin:20px 0}.footer{text-align:center;margin-top:30px;color:#666;font-size:14px}</style>
</head><body><div class="container">
<h2 style="color:#2c3e50">New team member added</h2>
<p>Hi ${adminName},</p>
<p>A new member has been added to your Slingvo workspace.</p>
<div class="info">
  <p style="margin:0"><strong>Name:</strong> ${agentName}</p>
  <p style="margin:8px 0 0"><strong>Email:</strong> ${agentEmail}</p>
</div>
<div class="footer"><p>© 2026 Slingvo. All rights reserved.</p></div>
</div>
        ${emailFooter()}
</body></html>`

export const memberRemovedTemp = (adminName: string, agentName: string, agentEmail: string) => `
<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><title>Member Removed - Slingvo</title>
<style>body{font-family:Arial,sans-serif;line-height:1.6;color:#333;max-width:600px;margin:0 auto;padding:20px;background:#f4f4f4}.container{background:#fff;padding:30px;border-radius:10px;box-shadow:0 2px 10px rgba(0,0,0,.1)}.logo{font-size:24px;font-weight:bold;color:#2c3e50;text-align:center;margin-bottom:30px}.info{background:#fff5f5;border:2px dashed #dc3545;padding:20px;border-radius:8px;margin:20px 0}.footer{text-align:center;margin-top:30px;color:#666;font-size:14px}</style>
</head><body><div class="container">
<h2 style="color:#2c3e50">Team member removed</h2>
<p>Hi ${adminName},</p>
<p>A member has been removed from your Slingvo workspace.</p>
<div class="info">
  <p style="margin:0"><strong>Name:</strong> ${agentName}</p>
  <p style="margin:8px 0 0"><strong>Email:</strong> ${agentEmail}</p>
</div>
<div class="footer"><p>© 2026 Slingvo. All rights reserved.</p></div>
</div>
        ${emailFooter()}
</body></html>`

export const roleChangedTemp = (userName: string, oldRole: string, newRole: string) => `
<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><title>Role Updated - Slingvo</title>
<style>body{font-family:Arial,sans-serif;line-height:1.6;color:#333;max-width:600px;margin:0 auto;padding:20px;background:#f4f4f4}.container{background:#fff;padding:30px;border-radius:10px;box-shadow:0 2px 10px rgba(0,0,0,.1)}.logo{font-size:24px;font-weight:bold;color:#2c3e50;text-align:center;margin-bottom:30px}.info{background:#f8f9fa;border:2px dashed #007bff;padding:20px;border-radius:8px;margin:20px 0}.footer{text-align:center;margin-top:30px;color:#666;font-size:14px}</style>
</head><body><div class="container">
<h2 style="color:#2c3e50">Your role has been updated</h2>
<p>Hi ${userName},</p>
<p>Your role in Slingvo has been changed.</p>
<div class="info">
  <p style="margin:0"><strong>Previous role:</strong> ${oldRole}</p>
  <p style="margin:8px 0 0"><strong>New role:</strong> ${newRole}</p>
</div>
<div class="footer"><p>© 2026 Slingvo. All rights reserved.</p></div>
</div>
        ${emailFooter()}
</body></html>`

export const workspaceCreatedTemp = (ownerName: string, adminEmail: string, adminName: string) => `
<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><title>New Workspace - Slingvo</title>
<style>body{font-family:Arial,sans-serif;line-height:1.6;color:#333;max-width:600px;margin:0 auto;padding:20px;background:#f4f4f4}.container{background:#fff;padding:30px;border-radius:10px;box-shadow:0 2px 10px rgba(0,0,0,.1)}.logo{font-size:24px;font-weight:bold;color:#2c3e50;text-align:center;margin-bottom:30px}.info{background:#f8f9fa;border:2px dashed #28a745;padding:20px;border-radius:8px;margin:20px 0}.footer{text-align:center;margin-top:30px;color:#666;font-size:14px}</style>
</head><body><div class="container">
<h2 style="color:#2c3e50">New workspace created</h2>
<p>Hi ${ownerName},</p>
<p>A new customer workspace has been provisioned on Slingvo.</p>
<div class="info">
  <p style="margin:0"><strong>Name:</strong> ${adminName}</p>
  <p style="margin:8px 0 0"><strong>Email:</strong> ${adminEmail}</p>
</div>
<div class="footer"><p>© 2026 Slingvo. All rights reserved.</p></div>
</div>
        ${emailFooter()}
</body></html>`

export const inactivityNudgeTemp = (fullName: string, loginUrl: string) => `
<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><title>We miss you - Slingvo</title>
<style>body{font-family:Arial,sans-serif;line-height:1.6;color:#333;max-width:600px;margin:0 auto;padding:20px;background:#f4f4f4}.container{background:#fff;padding:30px;border-radius:10px;box-shadow:0 2px 10px rgba(0,0,0,.1)}.logo{font-size:24px;font-weight:bold;color:#2c3e50;text-align:center;margin-bottom:30px}.footer{text-align:center;margin-top:30px;color:#666;font-size:14px}.button{display:inline-block;background:#FFCA06;color:#1a1a1a;padding:14px 32px;border-radius:8px;text-decoration:none;font-size:16px;font-weight:bold}</style>
</head><body><div class="container">
<h2 style="color:#2c3e50">We haven't seen you in a while</h2>
<p>Hi ${fullName},</p>
<p>It's been a few days since you last logged in to Slingvo. Your leads and team are waiting — jump back in whenever you're ready.</p>
<div style="text-align:center;margin:30px 0"><a href="${loginUrl}" class="button">Log back in</a></div>
<div class="footer"><p>© 2026 Slingvo. All rights reserved.</p></div>
</div>
        ${emailFooter()}
</body></html>`

export const subscribeReminderTemp = (fullName: string, subscribeUrl: string) => `
<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><title>Complete your setup - Slingvo</title>
<style>body{font-family:Arial,sans-serif;line-height:1.6;color:#333;max-width:600px;margin:0 auto;padding:20px;background:#f4f4f4}.container{background:#fff;padding:30px;border-radius:10px;box-shadow:0 2px 10px rgba(0,0,0,.1)}.logo{font-size:24px;font-weight:bold;color:#2c3e50;text-align:center;margin-bottom:30px}.footer{text-align:center;margin-top:30px;color:#666;font-size:14px}.button{display:inline-block;background:#FFCA06;color:#1a1a1a;padding:14px 32px;border-radius:8px;text-decoration:none;font-size:16px;font-weight:bold}</style>
</head><body><div class="container">
<h2 style="color:#2c3e50">Your account is ready — activate it now</h2>
<p>Hi ${fullName},</p>
<p>Your Slingvo account is set up, but you haven't started your subscription yet. Activate your plan to unlock your dialer, contacts, and team tools.</p>
<div style="text-align:center;margin:30px 0"><a href="${subscribeUrl}" class="button">Activate my plan</a></div>
<div class="footer"><p>© 2026 Slingvo. All rights reserved.</p></div>
</div>
        ${emailFooter()}
</body></html>`

export const reactivationTemp = (fullName: string, resubscribeUrl: string) => `
<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><title>Come back to Slingvo</title>
<style>body{font-family:Arial,sans-serif;line-height:1.6;color:#333;max-width:600px;margin:0 auto;padding:20px;background:#f4f4f4}.container{background:#fff;padding:30px;border-radius:10px;box-shadow:0 2px 10px rgba(0,0,0,.1)}.logo{font-size:24px;font-weight:bold;color:#2c3e50;text-align:center;margin-bottom:30px}.footer{text-align:center;margin-top:30px;color:#666;font-size:14px}.button{display:inline-block;background:#FFCA06;color:#1a1a1a;padding:14px 32px;border-radius:8px;text-decoration:none;font-size:16px;font-weight:bold}</style>
</head><body><div class="container">
<h2 style="color:#2c3e50">Your Slingvo access has ended — come back anytime</h2>
<p>Hi ${fullName},</p>
<p>Your Slingvo subscription is no longer active. Resubscribe to regain access to your dialer, contacts, and all your team's data.</p>
<div style="text-align:center;margin:30px 0"><a href="${resubscribeUrl}" class="button">Resubscribe now</a></div>
<div class="footer"><p>© 2026 Slingvo. All rights reserved.</p></div>
</div>
        ${emailFooter()}
</body></html>`

export const paymentFailedTemp = (fullName: string, amount: string, billingUrl: string) => `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Payment Failed - Slingvo</title>
    <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #f4f4f4; }
        .container { background-color: #ffffff; padding: 30px; border-radius: 10px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
        .header { text-align: center; margin-bottom: 30px; }
        .logo { font-size: 24px; font-weight: bold; color: #2c3e50; }
        .details-box { background: #fff5f5; border: 2px dashed #dc3545; padding: 20px; border-radius: 8px; margin: 20px 0; text-align: center; }
        .message { margin: 20px 0; }
        .footer { text-align: center; margin-top: 30px; color: #666; font-size: 14px; }
        .button { display: inline-block; background: #FFCA06; color: #1a1a1a; padding: 14px 32px; border-radius: 8px; text-decoration: none; font-size: 16px; font-weight: bold; }
    </style>
</head>
<body>
    <div class="container">
        <div class="message">
            <h2 style="color: #dc3545;">Your payment failed</h2>
            <p>Hi ${fullName},</p>
            <p>We were unable to process your latest Slingvo subscription payment of <strong>$${amount}</strong>. Please update your payment method to avoid interruption of service.</p>
        </div>
        <div class="details-box">
            <p style="margin:0;">Amount due: <strong>$${amount}</strong></p>
        </div>
        <div style="text-align:center; margin: 30px 0;">
            <a href="${billingUrl}" class="button">Update Payment Method</a>
        </div>
        <div class="footer"><p>© 2026 Slingvo. All rights reserved.</p></div>
    </div>
        ${emailFooter()}
</body>
</html>
`

export const paymentSucceededTemp = (fullName: string, amount: string, billingUrl: string) => `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Payment Received - Slingvo</title>
    <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #f4f4f4; }
        .container { background-color: #ffffff; padding: 30px; border-radius: 10px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
        .header { text-align: center; margin-bottom: 30px; }
        .logo { font-size: 24px; font-weight: bold; color: #2c3e50; }
        .details-box { background: #f8f9fa; border: 2px dashed #28a745; padding: 20px; border-radius: 8px; margin: 20px 0; text-align: center; }
        .message { margin: 20px 0; }
        .footer { text-align: center; margin-top: 30px; color: #666; font-size: 14px; }
        .button { display: inline-block; background: #FFCA06; color: #1a1a1a; padding: 14px 32px; border-radius: 8px; text-decoration: none; font-size: 16px; font-weight: bold; }
    </style>
</head>
<body>
    <div class="container">
        <div class="message">
            <h2 style="color: #28a745;">Payment received</h2>
            <p>Hi ${fullName},</p>
            <p>Thanks — we've received your Slingvo subscription payment.</p>
        </div>
        <div class="details-box">
            <p style="margin:0;">Amount paid: <strong>$${amount}</strong></p>
        </div>
        <div style="text-align:center; margin: 30px 0;">
            <a href="${billingUrl}" class="button">View Billing Details</a>
        </div>
        <div class="footer"><p>© 2026 Slingvo. All rights reserved.</p></div>
    </div>
        ${emailFooter()}
</body>
</html>
`

export const subscriptionCancelledTemp = (fullName: string, planName: string, billingUrl: string) => `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Subscription Cancelled - Slingvo</title>
    <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #f4f4f4; }
        .container { background-color: #ffffff; padding: 30px; border-radius: 10px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
        .header { text-align: center; margin-bottom: 30px; }
        .logo { font-size: 24px; font-weight: bold; color: #2c3e50; }
        .message { margin: 20px 0; }
        .footer { text-align: center; margin-top: 30px; color: #666; font-size: 14px; }
        .button { display: inline-block; background: #FFCA06; color: #1a1a1a; padding: 14px 32px; border-radius: 8px; text-decoration: none; font-size: 16px; font-weight: bold; }
    </style>
</head>
<body>
    <div class="container">
        <div class="message">
            <h2 style="color: #2c3e50;">Your subscription has been cancelled</h2>
            <p>Hi ${fullName},</p>
            <p>Your <strong>${planName}</strong> subscription has been cancelled and your account access has ended. If this wasn't intentional, you can resubscribe at any time.</p>
        </div>
        <div style="text-align:center; margin: 30px 0;">
            <a href="${billingUrl}" class="button">Resubscribe</a>
        </div>
        <div class="footer"><p>© 2026 Slingvo. All rights reserved.</p></div>
    </div>
        ${emailFooter()}
</body>
</html>
`

export const subscriptionChangedTemp = (
    fullName: string,
    direction: "upgraded" | "downgraded",
    oldPlan: string,
    newPlan: string,
    amount: string,
    billingUrl: string,
) => `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Subscription ${direction === "upgraded" ? "Upgraded" : "Downgraded"} - Slingvo</title>
    <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #f4f4f4; }
        .container { background-color: #ffffff; padding: 30px; border-radius: 10px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
        .header { text-align: center; margin-bottom: 30px; }
        .logo { font-size: 24px; font-weight: bold; color: #2c3e50; }
        .details-box { background: #f8f9fa; border: 2px dashed #28a745; padding: 20px; border-radius: 8px; margin: 20px 0; text-align: center; }
        .message { margin: 20px 0; }
        .footer { text-align: center; margin-top: 30px; color: #666; font-size: 14px; }
        .button { display: inline-block; background: #FFCA06; color: #1a1a1a; padding: 14px 32px; border-radius: 8px; text-decoration: none; font-size: 16px; font-weight: bold; }
    </style>
</head>
<body>
    <div class="container">
        <div class="message">
            <h2 style="color: #2c3e50;">Your subscription was ${direction}</h2>
            <p>Hi ${fullName},</p>
            <p>Your Slingvo subscription changed from <strong>${oldPlan}</strong> to <strong>${newPlan}</strong>.</p>
        </div>
        <div class="details-box">
            <p style="margin:0;">New amount: <strong>$${amount}</strong></p>
        </div>
        <div style="text-align:center; margin: 30px 0;">
            <a href="${billingUrl}" class="button">View Billing Details</a>
        </div>
        <div class="footer"><p>© 2026 Slingvo. All rights reserved.</p></div>
    </div>
        ${emailFooter()}
</body>
</html>
`

export const gettingStartedTemp = (fullName: string, dashboardUrl: string) => `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Get Started with Slingvo</title>
    <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #f4f4f4; }
        .container { background-color: #ffffff; padding: 30px; border-radius: 10px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
        .header { text-align: center; margin-bottom: 30px; }
        .logo { font-size: 24px; font-weight: bold; color: #2c3e50; }
        .step { display: flex; align-items: flex-start; margin: 18px 0; }
        .step-number { background: #FFCA06; color: #1a1a1a; font-weight: bold; font-size: 15px; min-width: 32px; height: 32px; border-radius: 50%; display: inline-flex; align-items: center; justify-content: center; margin-right: 14px; flex-shrink: 0; }
        .step-body h3 { margin: 0 0 4px; font-size: 15px; color: #2c3e50; }
        .step-body p { margin: 0; font-size: 14px; color: #555; }
        .divider { border: none; border-top: 1px solid #eee; margin: 24px 0; }
        .footer { text-align: center; margin-top: 30px; color: #666; font-size: 14px; }
        .button { display: inline-block; background: #FFCA06; color: #1a1a1a; padding: 14px 32px; border-radius: 8px; text-decoration: none; font-size: 16px; font-weight: bold; }
    </style>
</head>
<body>
    <div class="container">
        <h2 style="color: #2c3e50; margin-top: 0;">Here's how to get started</h2>
        <p>Hi ${fullName},</p>
        <p>Your Slingvo workspace is ready. Follow these steps to get up and running quickly:</p>

        <div class="step">
            <span class="step-number">1</span>
            <div class="step-body">
                <h3>Set up your caller IDs</h3>
                <p>Add the phone numbers your agents will dial from. Go to <strong>Settings → Phone Numbers</strong> to configure your lines.</p>
            </div>
        </div>
        <div class="step">
            <span class="step-number">2</span>
            <div class="step-body">
                <h3>Invite your agents</h3>
                <p>Add your team under <strong>Team Management</strong>. Each agent gets their own login and call queue.</p>
            </div>
        </div>
        <div class="step">
            <span class="step-number">3</span>
            <div class="step-body">
                <h3>Import your contacts</h3>
                <p>Upload a CSV of leads or add contacts manually from <strong>Contacts</strong>. This is what your agents will dial through.</p>
            </div>
        </div>
        <div class="step">
            <span class="step-number">4</span>
            <div class="step-body">
                <h3>Launch a campaign</h3>
                <p>Create a campaign, assign contacts and agents, and start dialing. Monitor progress in real time from your <strong>Dashboard</strong>.</p>
            </div>
        </div>

        <hr class="divider" />
        <p style="font-size:14px;color:#555;">Need help? Reach out to our support team anytime — we're here to make sure you succeed.</p>
        <div style="text-align:center; margin: 30px 0;">
            <a href="${dashboardUrl}" class="button">Go to Dashboard</a>
        </div>
        <div class="footer"><p>© 2026 Slingvo. All rights reserved.</p></div>
    </div>
        ${emailFooter()}
</body>
</html>
`

export const trialStartedTemp = (fullName: string, trialEndDate: string, dashboardUrl: string) => `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Your Free Trial Has Started - Slingvo</title>
    <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #f4f4f4; }
        .container { background-color: #ffffff; padding: 30px; border-radius: 10px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
        .header { text-align: center; margin-bottom: 30px; }
        .logo { font-size: 24px; font-weight: bold; color: #2c3e50; }
        .highlight { background: #fff8e1; border: 2px solid #FFCA06; padding: 20px; border-radius: 8px; margin: 20px 0; text-align: center; }
        .message { margin: 20px 0; }
        .footer { text-align: center; margin-top: 30px; color: #666; font-size: 14px; }
        .button { display: inline-block; background: #FFCA06; color: #1a1a1a; padding: 14px 32px; border-radius: 8px; text-decoration: none; font-size: 16px; font-weight: bold; }
    </style>
</head>
<body>
    <div class="container">
        <div class="message">
            <h2 style="color: #2c3e50;">Your 30-day free trial has started!</h2>
            <p>Hi ${fullName},</p>
            <p>Welcome to Slingvo! Your free trial is now active — explore every feature for the next 30 days, no charge.</p>
        </div>
        <div class="highlight">
            <p style="margin:0;font-size:15px;">Trial ends on <strong>${trialEndDate}</strong></p>
        </div>
        <p>After your trial, you'll be moved to your selected plan. You can manage or cancel any time from your billing page.</p>
        <div style="text-align:center; margin: 30px 0;">
            <a href="${dashboardUrl}" class="button">Go to Dashboard</a>
        </div>
        <div class="footer"><p>© 2026 Slingvo. All rights reserved.</p></div>
    </div>
        ${emailFooter()}
</body>
</html>
`

export const subscriptionActivatedTemp = (fullName: string, planName: string, dashboardUrl: string) => `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Subscription Activated - Slingvo</title>
    <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #f4f4f4; }
        .container { background-color: #ffffff; padding: 30px; border-radius: 10px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
        .header { text-align: center; margin-bottom: 30px; }
        .logo { font-size: 24px; font-weight: bold; color: #2c3e50; }
        .highlight { background: #f0fdf4; border: 2px solid #22c55e; padding: 20px; border-radius: 8px; margin: 20px 0; text-align: center; }
        .message { margin: 20px 0; }
        .footer { text-align: center; margin-top: 30px; color: #666; font-size: 14px; }
        .button { display: inline-block; background: #FFCA06; color: #1a1a1a; padding: 14px 32px; border-radius: 8px; text-decoration: none; font-size: 16px; font-weight: bold; }
    </style>
</head>
<body>
    <div class="container">
        <div class="message">
            <h2 style="color: #2c3e50;">Your subscription is now active</h2>
            <p>Hi ${fullName},</p>
            <p>Your Slingvo subscription has been activated. You now have full access to all features on your plan.</p>
        </div>
        <div class="highlight">
            <p style="margin:0;font-size:15px;">Active plan: <strong>${planName}</strong></p>
        </div>
        <div style="text-align:center; margin: 30px 0;">
            <a href="${dashboardUrl}" class="button">Go to Dashboard</a>
        </div>
        <div class="footer"><p>© 2026 Slingvo. All rights reserved.</p></div>
    </div>
        ${emailFooter()}
</body>
</html>
`

export const trialEndingSoonTemp = (fullName: string, daysLeft: number, billingUrl: string) => `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Your Trial Ends Soon - Slingvo</title>
    <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #f4f4f4; }
        .container { background-color: #ffffff; padding: 30px; border-radius: 10px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
        .header { text-align: center; margin-bottom: 30px; }
        .logo { font-size: 24px; font-weight: bold; color: #2c3e50; }
        .highlight { background: #fff7ed; border: 2px solid #f97316; padding: 20px; border-radius: 8px; margin: 20px 0; text-align: center; }
        .message { margin: 20px 0; }
        .footer { text-align: center; margin-top: 30px; color: #666; font-size: 14px; }
        .button { display: inline-block; background: #FFCA06; color: #1a1a1a; padding: 14px 32px; border-radius: 8px; text-decoration: none; font-size: 16px; font-weight: bold; }
    </style>
</head>
<body>
    <div class="container">
        <div class="message">
            <h2 style="color: #2c3e50;">Your trial ends in ${daysLeft} day${daysLeft === 1 ? "" : "s"}</h2>
            <p>Hi ${fullName},</p>
            <p>Your Slingvo free trial is almost over. After it ends, you'll be charged for your selected plan to keep full access.</p>
        </div>
        <div class="highlight">
            <p style="margin:0;font-size:15px;"><strong>${daysLeft} day${daysLeft === 1 ? "" : "s"} remaining</strong> on your trial</p>
        </div>
        <p>Make sure your billing details are up to date to continue without interruption.</p>
        <div style="text-align:center; margin: 30px 0;">
            <a href="${billingUrl}" class="button">Review Billing</a>
        </div>
        <div class="footer"><p>© 2026 Slingvo. All rights reserved.</p></div>
    </div>
        ${emailFooter()}
</body>
</html>
`

export const subscriptionPausedTemp = (fullName: string, billingUrl: string) => `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Subscription Paused - Slingvo</title>
    <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #f4f4f4; }
        .container { background-color: #ffffff; padding: 30px; border-radius: 10px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
        .header { text-align: center; margin-bottom: 30px; }
        .logo { font-size: 24px; font-weight: bold; color: #2c3e50; }
        .message { margin: 20px 0; }
        .footer { text-align: center; margin-top: 30px; color: #666; font-size: 14px; }
        .button { display: inline-block; background: #FFCA06; color: #1a1a1a; padding: 14px 32px; border-radius: 8px; text-decoration: none; font-size: 16px; font-weight: bold; }
    </style>
</head>
<body>
    <div class="container">
        <div class="message">
            <h2 style="color: #2c3e50;">Your subscription has been paused</h2>
            <p>Hi ${fullName},</p>
            <p>Your Slingvo subscription is currently paused. Your account access is limited while the subscription is on hold.</p>
            <p>To restore full access, visit your billing page and reactivate your plan.</p>
        </div>
        <div style="text-align:center; margin: 30px 0;">
            <a href="${billingUrl}" class="button">Reactivate Subscription</a>
        </div>
        <div class="footer"><p>© 2026 Slingvo. All rights reserved.</p></div>
    </div>
        ${emailFooter()}
</body>
</html>
`

export const subscriptionExpiredTemp = (fullName: string, billingUrl: string) => `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Subscription Expired - Slingvo</title>
    <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #f4f4f4; }
        .container { background-color: #ffffff; padding: 30px; border-radius: 10px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
        .header { text-align: center; margin-bottom: 30px; }
        .logo { font-size: 24px; font-weight: bold; color: #2c3e50; }
        .message { margin: 20px 0; }
        .footer { text-align: center; margin-top: 30px; color: #666; font-size: 14px; }
        .button { display: inline-block; background: #FFCA06; color: #1a1a1a; padding: 14px 32px; border-radius: 8px; text-decoration: none; font-size: 16px; font-weight: bold; }
    </style>
</head>
<body>
    <div class="container">
        <div class="message">
            <h2 style="color: #2c3e50;">Your Slingvo subscription has expired</h2>
            <p>Hi ${fullName},</p>
            <p>Your subscription has expired due to an incomplete payment. Access to Slingvo features has been suspended.</p>
            <p>Resubscribe at any time to restore your account.</p>
        </div>
        <div style="text-align:center; margin: 30px 0;">
            <a href="${billingUrl}" class="button">Resubscribe Now</a>
        </div>
        <div class="footer"><p>© 2026 Slingvo. All rights reserved.</p></div>
    </div>
        ${emailFooter()}
</body>
</html>
`

export const paymentReceiptTemp = (fullName: string, amount: string, invoiceNumber: string, billingUrl: string) => `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Payment Receipt - Slingvo</title>
    <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #f4f4f4; }
        .container { background-color: #ffffff; padding: 30px; border-radius: 10px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
        .header { text-align: center; margin-bottom: 30px; }
        .logo { font-size: 24px; font-weight: bold; color: #2c3e50; }
        .receipt-box { background: #f8f9fa; border: 2px dashed #28a745; padding: 20px; border-radius: 8px; margin: 20px 0; }
        .receipt-row { display: flex; justify-content: space-between; padding: 6px 0; border-bottom: 1px solid #e9ecef; }
        .receipt-row:last-child { border-bottom: none; }
        .message { margin: 20px 0; }
        .footer { text-align: center; margin-top: 30px; color: #666; font-size: 14px; }
        .button { display: inline-block; background: #FFCA06; color: #1a1a1a; padding: 14px 32px; border-radius: 8px; text-decoration: none; font-size: 16px; font-weight: bold; }
    </style>
</head>
<body>
    <div class="container">
        <div class="message">
            <h2 style="color: #2c3e50;">Payment Receipt</h2>
            <p>Hi ${fullName},</p>
            <p>Thank you! Your payment has been received. Here is your receipt.</p>
        </div>
        <div class="receipt-box">
            <div class="receipt-row"><span>Invoice</span><strong>${invoiceNumber}</strong></div>
            <div class="receipt-row"><span>Amount Paid</span><strong>$${amount}</strong></div>
        </div>
        <div style="text-align:center; margin: 30px 0;">
            <a href="${billingUrl}" class="button">View Billing History</a>
        </div>
        <div class="footer"><p>© 2026 Slingvo. All rights reserved.</p></div>
    </div>
        ${emailFooter()}
</body>
</html>
`

export const subscriptionRenewedTemp = (fullName: string, planName: string, amount: string, invoiceNumber: string, billingUrl: string) => `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Subscription Renewed - Slingvo</title>
    <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #f4f4f4; }
        .container { background-color: #ffffff; padding: 30px; border-radius: 10px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
        .header { text-align: center; margin-bottom: 30px; }
        .logo { font-size: 24px; font-weight: bold; color: #2c3e50; }
        .receipt-box { background: #f8f9fa; border: 2px dashed #28a745; padding: 20px; border-radius: 8px; margin: 20px 0; }
        .receipt-row { display: flex; justify-content: space-between; padding: 6px 0; border-bottom: 1px solid #e9ecef; }
        .receipt-row:last-child { border-bottom: none; }
        .message { margin: 20px 0; }
        .footer { text-align: center; margin-top: 30px; color: #666; font-size: 14px; }
        .button { display: inline-block; background: #FFCA06; color: #1a1a1a; padding: 14px 32px; border-radius: 8px; text-decoration: none; font-size: 16px; font-weight: bold; }
    </style>
</head>
<body>
    <div class="container">
        <div class="message">
            <h2 style="color: #2c3e50;">Your subscription has renewed</h2>
            <p>Hi ${fullName},</p>
            <p>Your <strong>${planName}</strong> subscription renewed successfully — here's your receipt for this billing cycle.</p>
        </div>
        <div class="receipt-box">
            <div class="receipt-row"><span>Invoice</span><strong>${invoiceNumber}</strong></div>
            <div class="receipt-row"><span>Amount Charged</span><strong>$${amount}</strong></div>
        </div>
        <div style="text-align:center; margin: 30px 0;">
            <a href="${billingUrl}" class="button">View Billing History</a>
        </div>
        <div class="footer"><p>© 2026 Slingvo. All rights reserved.</p></div>
    </div>
        ${emailFooter()}
</body>
</html>
`

export const agentInviteTemp = (fullName: string, adminName: string, email: string, setPasswordUrl: string) => `
<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>You've Been Invited to Slingvo</title>
<style>body{font-family:Arial,sans-serif;line-height:1.6;color:#333;max-width:600px;margin:0 auto;padding:20px;background:#f4f4f4}.container{background:#fff;padding:30px;border-radius:10px;box-shadow:0 2px 10px rgba(0,0,0,.1)}.credentials{background:#f8f9fa;border:2px dashed #28a745;padding:20px;border-radius:8px;margin:20px 0}.cred-row{margin:6px 0;font-size:15px}.footer{text-align:center;margin-top:30px;color:#666;font-size:14px}.button{display:inline-block;background:#FFCA06;color:#1a1a1a;padding:14px 32px;border-radius:8px;text-decoration:none;font-size:16px;font-weight:bold}</style>
</head><body><div class="container">
<h2 style="color:#2c3e50">You've been invited to Slingvo</h2>
<p>Hi ${fullName || "there"},</p>
<p><strong>${adminName}</strong> has added you as an agent on their Slingvo workspace. To activate your account, choose your own password using the button below.</p>
<div class="credentials">
  <div class="cred-row"><strong>Email:</strong> ${email}</div>
</div>
<div style="text-align:center;margin:30px 0"><a href="${setPasswordUrl}" class="button">Set Password</a></div>
<p style="font-size:13px;color:#666;">This link is single-use and stops working the moment you set your password. If you didn't expect this invite, please ignore this email.</p>
<div class="footer"><p>© 2026 Slingvo. All rights reserved.</p></div>
</div>
        ${emailFooter()}
</body></html>`

export const refundConfirmationTemp = (fullName: string, amount: string, billingUrl: string) => `
<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Refund Processed - Slingvo</title>
<style>body{font-family:Arial,sans-serif;line-height:1.6;color:#333;max-width:600px;margin:0 auto;padding:20px;background:#f4f4f4}.container{background:#fff;padding:30px;border-radius:10px;box-shadow:0 2px 10px rgba(0,0,0,.1)}.logo{font-size:24px;font-weight:bold;color:#2c3e50;text-align:center;margin-bottom:30px}.receipt-box{background:#f0fdf4;border:2px dashed #22c55e;padding:20px;border-radius:8px;margin:20px 0;text-align:center}.footer{text-align:center;margin-top:30px;color:#666;font-size:14px}.button{display:inline-block;background:#FFCA06;color:#1a1a1a;padding:14px 32px;border-radius:8px;text-decoration:none;font-size:16px;font-weight:bold}</style>
</head><body><div class="container">
<h2 style="color:#2c3e50">Your refund has been processed</h2>
<p>Hi ${fullName},</p>
<p>We have successfully issued a refund to your payment method on file. Please allow 5–10 business days for the amount to appear on your statement.</p>
<div class="receipt-box">
  <p style="margin:0;font-size:15px;">Refund amount: <strong>$${amount}</strong></p>
</div>
<div style="text-align:center;margin:30px 0"><a href="${billingUrl}" class="button">View Billing History</a></div>
<div class="footer"><p>© 2026 Slingvo. All rights reserved.</p></div>
</div>
        ${emailFooter()}
</body></html>`

export const invoiceUncollectibleTemp = (fullName: string, amount: string, billingUrl: string) => `
<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Invoice Uncollectible - Slingvo</title>
<style>body{font-family:Arial,sans-serif;line-height:1.6;color:#333;max-width:600px;margin:0 auto;padding:20px;background:#f4f4f4}.container{background:#fff;padding:30px;border-radius:10px;box-shadow:0 2px 10px rgba(0,0,0,.1)}.logo{font-size:24px;font-weight:bold;color:#2c3e50;text-align:center;margin-bottom:30px}.alert-box{background:#fff5f5;border:2px dashed #dc3545;padding:20px;border-radius:8px;margin:20px 0;text-align:center}.footer{text-align:center;margin-top:30px;color:#666;font-size:14px}.button{display:inline-block;background:#FFCA06;color:#1a1a1a;padding:14px 32px;border-radius:8px;text-decoration:none;font-size:16px;font-weight:bold}</style>
</head><body><div class="container">
<h2 style="color:#dc3545">We were unable to collect your payment</h2>
<p>Hi ${fullName},</p>
<p>After several attempts, we were unable to collect payment on your Slingvo invoice. As a result, some services associated with this invoice have been paused or removed.</p>
<div class="alert-box">
  <p style="margin:0;font-size:15px;">Outstanding amount: <strong>$${amount}</strong></p>
</div>
<p>To restore full access, please update your payment method and contact support to reinstate any removed services.</p>
<div style="text-align:center;margin:30px 0"><a href="${billingUrl}" class="button">Update Payment Method</a></div>
<div class="footer"><p>© 2026 Slingvo. All rights reserved.</p></div>
</div>
        ${emailFooter()}
</body></html>`

export const paymentMethodAddedTemp = (fullName: string, cardBrand: string, cardLast4: string, billingUrl: string) => `
<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Payment Method Added - Slingvo</title>
<style>body{font-family:Arial,sans-serif;line-height:1.6;color:#333;max-width:600px;margin:0 auto;padding:20px;background:#f4f4f4}.container{background:#fff;padding:30px;border-radius:10px;box-shadow:0 2px 10px rgba(0,0,0,.1)}.logo{font-size:24px;font-weight:bold;color:#2c3e50;text-align:center;margin-bottom:30px}.info-box{background:#f8f9fa;border:2px dashed #007bff;padding:20px;border-radius:8px;margin:20px 0;text-align:center}.footer{text-align:center;margin-top:30px;color:#666;font-size:14px}.button{display:inline-block;background:#FFCA06;color:#1a1a1a;padding:14px 32px;border-radius:8px;text-decoration:none;font-size:16px;font-weight:bold}</style>
</head><body><div class="container">
<h2 style="color:#2c3e50">New payment method added</h2>
<p>Hi ${fullName},</p>
<p>A new payment method was added to your Slingvo account. If you made this change, no action is needed.</p>
<div class="info-box">
  <p style="margin:0;font-size:15px;">${cardBrand} &bull;&bull;&bull;&bull; ${cardLast4}</p>
</div>
<p style="font-size:14px;color:#666;">If you did not add this card, please update your payment method immediately and contact support.</p>
<div style="text-align:center;margin:30px 0"><a href="${billingUrl}" class="button">Manage Payment Methods</a></div>
<div class="footer"><p>© 2026 Slingvo. All rights reserved.</p></div>
</div>
        ${emailFooter()}
</body></html>`

export const upcomingInvoiceTemp = (fullName: string, amount: string, billingUrl: string) => `
<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Upcoming Invoice - Slingvo</title>
<style>body{font-family:Arial,sans-serif;line-height:1.6;color:#333;max-width:600px;margin:0 auto;padding:20px;background:#f4f4f4}.container{background:#fff;padding:30px;border-radius:10px;box-shadow:0 2px 10px rgba(0,0,0,.1)}.logo{font-size:24px;font-weight:bold;color:#2c3e50;text-align:center;margin-bottom:30px}.invoice-box{background:#f8f9fa;border:2px dashed #6c757d;padding:20px;border-radius:8px;margin:20px 0;text-align:center}.footer{text-align:center;margin-top:30px;color:#666;font-size:14px}.button{display:inline-block;background:#FFCA06;color:#1a1a1a;padding:14px 32px;border-radius:8px;text-decoration:none;font-size:16px;font-weight:bold}</style>
</head><body><div class="container">
<h2 style="color:#2c3e50">Your upcoming Slingvo invoice</h2>
<p>Hi ${fullName},</p>
<p>Your next Slingvo invoice has been generated and will be charged to your payment method on file shortly.</p>
<div class="invoice-box">
  <p style="margin:0;font-size:15px;">Amount due: <strong>$${amount}</strong></p>
</div>
<p style="font-size:14px;color:#666;">Make sure your payment method is up to date to avoid any interruption in service.</p>
<div style="text-align:center;margin:30px 0"><a href="${billingUrl}" class="button">View Billing Details</a></div>
<div class="footer"><p>© 2026 Slingvo. All rights reserved.</p></div>
</div>
        ${emailFooter()}
</body></html>`

export const cardExpiringTemp = (fullName: string, cardBrand: string, cardLast4: string, expMonth: number, expYear: number, billingUrl: string) => `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Payment Method Expiring Soon - Slingvo</title>
    <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #f4f4f4; }
        .container { background-color: #ffffff; padding: 30px; border-radius: 10px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
        .header { text-align: center; margin-bottom: 30px; }
        .logo { font-size: 24px; font-weight: bold; color: #2c3e50; }
        .card-box { background: #fff7ed; border: 2px solid #f97316; padding: 20px; border-radius: 8px; margin: 20px 0; text-align: center; }
        .message { margin: 20px 0; }
        .footer { text-align: center; margin-top: 30px; color: #666; font-size: 14px; }
        .button { display: inline-block; background: #FFCA06; color: #1a1a1a; padding: 14px 32px; border-radius: 8px; text-decoration: none; font-size: 16px; font-weight: bold; }
    </style>
</head>
<body>
    <div class="container">
        <div class="message">
            <h2 style="color: #2c3e50;">Your payment method expires soon</h2>
            <p>Hi ${fullName},</p>
            <p>The card on file for your Slingvo subscription is expiring. Please update your payment method to avoid service interruption.</p>
        </div>
        <div class="card-box">
            <p style="margin:0;font-size:15px;">${cardBrand} &bull;&bull;&bull;&bull; ${cardLast4} &mdash; expires <strong>${String(expMonth).padStart(2, "0")}/${expYear}</strong></p>
        </div>
        <div style="text-align:center; margin: 30px 0;">
            <a href="${billingUrl}" class="button">Update Payment Method</a>
        </div>
        <div class="footer"><p>© 2026 Slingvo. All rights reserved.</p></div>
    </div>
        ${emailFooter()}
</body>
</html>
`

// Sent to BOTH the old and new addresses when an admin changes a user's
// email in the Super-Admin UI (bypasses Better Auth's own change-email
// verification flow, so nothing else notifies either party). GA 4.0 audit
// finding: "changing a user's email sends no notification to either address."
export const emailChangedByAdminTemp = (fullName: string, oldEmail: string, newEmail: string, kind: "old" | "new") => `
<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Your Slingvo email address was changed</title>
<style>body{font-family:Arial,sans-serif;line-height:1.6;color:#333;max-width:600px;margin:0 auto;padding:20px;background:#f4f4f4}.container{background:#fff;padding:30px;border-radius:10px;box-shadow:0 2px 10px rgba(0,0,0,.1)}.info{background:#fffbeb;border:2px dashed #f59e0b;padding:20px;border-radius:8px;margin:20px 0}.footer{text-align:center;margin-top:30px;color:#666;font-size:14px}</style>
</head><body><div class="container">
<h2 style="color:#2c3e50">Your Slingvo email address was changed</h2>
<p>Hi ${fullName || "there"},</p>
<p>${kind === "old"
  ? "An administrator has changed the email address on your Slingvo account. Future emails from us will be sent to the new address below."
  : "An administrator has updated your Slingvo account to use this email address. You'll now receive all future account emails here."}</p>
<div class="info">
  <p style="margin:4px 0"><strong>Previous email:</strong> ${oldEmail}</p>
  <p style="margin:4px 0"><strong>New email:</strong> ${newEmail}</p>
</div>
<p style="font-size:14px;color:#666;">If you didn't expect this change, please contact your administrator or reply to support@slingvo.com immediately.</p>
<div class="footer"><p>© 2026 Slingvo. All rights reserved.</p></div>
</div>
        ${emailFooter()}
</body></html>`

// Sent to the deleted user themselves before their account is removed.
// GA 4.0 audit finding: "deleting a user sends nothing and has no
// confirmation prompt - one click and the account is gone."
export const accountClosedTemp = (fullName: string, closedByRole: "admin" | "system") => `
<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Your Slingvo account has been closed</title>
<style>body{font-family:Arial,sans-serif;line-height:1.6;color:#333;max-width:600px;margin:0 auto;padding:20px;background:#f4f4f4}.container{background:#fff;padding:30px;border-radius:10px;box-shadow:0 2px 10px rgba(0,0,0,.1)}.footer{text-align:center;margin-top:30px;color:#666;font-size:14px}</style>
</head><body><div class="container">
<h2 style="color:#2c3e50">Your Slingvo account has been closed</h2>
<p>Hi ${fullName || "there"},</p>
<p>Your Slingvo account has been closed${closedByRole === "admin" ? " by an administrator" : ""}. You will no longer be able to sign in, and this address will not receive further account emails after this one.</p>
<p style="font-size:14px;color:#666;">If you believe this was done in error, please contact support@slingvo.com right away.</p>
<div class="footer"><p>© 2026 Slingvo. All rights reserved.</p></div>
</div>
        ${emailFooter()}
</body></html>`

import { sendEmail as trackedSendEmail } from "../services/email.service";

export const sendEmail = async (
    to: string,
    subject: string,
    html: string,
    tracking?: {
        userId: string;
        contactId?: string;
        leadId?: string;
        templateId?: string;
        includeUnsubscribe?: boolean;
        companyId?: string;
        replyToEmail?: string;
    }
) => {
    try {
        return await trackedSendEmail({
            to,
            from: envConfig.MAILERSEND_FROM_EMAIL || envConfig.EMAIL_USER || "noreply@slingvo.com",
            subject,
            text: "Please view this email in an HTML compatible client.",
            html,
            userId: tracking?.userId,
            contactId: tracking?.contactId,
            leadId: tracking?.leadId,
            templateId: tracking?.templateId,
            includeUnsubscribe: tracking?.includeUnsubscribe,
            companyId: tracking?.companyId,
            replyToEmail: tracking?.replyToEmail,
        });
    }
    catch (error) {
        console.log("Error sending email via utils:", error);
        return { error };
    }
}