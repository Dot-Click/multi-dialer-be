import { envConfig } from "../lib/config";
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
    <title>Welcome to Slingvo</title>
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
        <div class="header"><div class="logo">Slingvo</div></div>
        <div class="message">
            <h2>Welcome to Slingvo!</h2>
            <p>Your account has been successfully created. Here are your login details:</p>
        </div>
        <div class="details-box">
            <div class="credential"><span class="label">Email:</span> ${email}</div>
            <div class="credential"><span class="label">Password:</span> ${password}</div>
        </div>
        <div class="message">
            <p>Please login and change your password after your first login.</p>
        </div>
        <div class="footer"><p>© 2026 Slingvo. All rights reserved.</p></div>
    </div>
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
            <p>Sent via CallScout Dialer</p>
            <p>© 2026 All rights reserved.</p>
        </div>
    </div>
</body>
</html>
`

export const newUserSignupTemp = (userEmail: string, signupTime: string) => `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>New User Signup on CallScout</title>
    <style>
        body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #f4f6f8; }
        .container { background-color: #ffffff; padding: 30px; border-radius: 10px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
        .header { text-align: center; border-bottom: 2px solid #28a745; margin-bottom: 20px; padding-bottom: 10px; }
        .logo { font-size: 24px; font-weight: bold; color: #2c3e50; }
        .content { margin: 20px 0; font-size: 16px; }
        .highlight { font-weight: bold; color: #28a745; }
        .footer { text-align: center; margin-top: 30px; color: #999; font-size: 12px; }
    </style>
</head>
<body>
    <div class="container">
        <div class="header"><div class="logo">CallScout</div></div>
        <div class="content">
            <h2 style="color: #2c3e50;">New User Signup Notification</h2>
            <p>Hello,</p>
            <p>A new user has signed up on <span class="highlight">CallScout</span>.</p>
            <p><strong>User Email:</strong> ${userEmail}</p>
            <p><strong>Signup Time:</strong> ${signupTime}</p>
        </div>
        <div class="footer">
            <p>© 2026 CallScout. All rights reserved.</p>
        </div>
    </div>
</body>
</html>
`

export const loginAlertTemp = (userEmail: string, loginTime: string) => `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>User Login Alert - CallScout</title>
    <style>
        body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #f4f6f8; }
        .container { background-color: #ffffff; padding: 30px; border-radius: 10px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
        .header { text-align: center; border-bottom: 20px solid #007bff; margin-bottom: 20px; padding-bottom: 10px; border-width: 2px; }
        .logo { font-size: 24px; font-weight: bold; color: #2c3e50; }
        .content { margin: 20px 0; font-size: 16px; }
        .highlight { font-weight: bold; color: #007bff; }
        .footer { text-align: center; margin-top: 30px; color: #999; font-size: 12px; }
    </style>
</head>
<body>
    <div class="container">
        <div class="header"><div class="logo">CallScout</div></div>
        <div class="content">
            <h2 style="color: #2c3e50;">User Login Alert</h2>
            <p>Hello,</p>
            <p>A user has logged in to <span class="highlight">CallScout</span>.</p>
            <p><strong>Account:</strong> ${userEmail}</p>
            <p><strong>Login Time:</strong> ${loginTime}</p>
        </div>
        <div class="footer">
            <p>© 2026 CallScout. All rights reserved.</p>
        </div>
    </div>
</body>
</html>
`

// ── Admin / lifecycle notification templates ──────────────────────────────────

export const memberAddedTemp = (adminName: string, agentName: string, agentEmail: string) => `
<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><title>Member Added - Slingvo</title>
<style>body{font-family:Arial,sans-serif;line-height:1.6;color:#333;max-width:600px;margin:0 auto;padding:20px;background:#f4f4f4}.container{background:#fff;padding:30px;border-radius:10px;box-shadow:0 2px 10px rgba(0,0,0,.1)}.logo{font-size:24px;font-weight:bold;color:#2c3e50;text-align:center;margin-bottom:30px}.info{background:#f8f9fa;border:2px dashed #28a745;padding:20px;border-radius:8px;margin:20px 0}.footer{text-align:center;margin-top:30px;color:#666;font-size:14px}</style>
</head><body><div class="container">
<div class="logo">Slingvo</div>
<h2 style="color:#2c3e50">New team member added</h2>
<p>Hi ${adminName},</p>
<p>A new member has been added to your Slingvo workspace.</p>
<div class="info">
  <p style="margin:0"><strong>Name:</strong> ${agentName}</p>
  <p style="margin:8px 0 0"><strong>Email:</strong> ${agentEmail}</p>
</div>
<div class="footer"><p>© 2026 Slingvo. All rights reserved.</p></div>
</div></body></html>`

export const memberRemovedTemp = (adminName: string, agentName: string, agentEmail: string) => `
<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><title>Member Removed - Slingvo</title>
<style>body{font-family:Arial,sans-serif;line-height:1.6;color:#333;max-width:600px;margin:0 auto;padding:20px;background:#f4f4f4}.container{background:#fff;padding:30px;border-radius:10px;box-shadow:0 2px 10px rgba(0,0,0,.1)}.logo{font-size:24px;font-weight:bold;color:#2c3e50;text-align:center;margin-bottom:30px}.info{background:#fff5f5;border:2px dashed #dc3545;padding:20px;border-radius:8px;margin:20px 0}.footer{text-align:center;margin-top:30px;color:#666;font-size:14px}</style>
</head><body><div class="container">
<div class="logo">Slingvo</div>
<h2 style="color:#2c3e50">Team member removed</h2>
<p>Hi ${adminName},</p>
<p>A member has been removed from your Slingvo workspace.</p>
<div class="info">
  <p style="margin:0"><strong>Name:</strong> ${agentName}</p>
  <p style="margin:8px 0 0"><strong>Email:</strong> ${agentEmail}</p>
</div>
<div class="footer"><p>© 2026 Slingvo. All rights reserved.</p></div>
</div></body></html>`

export const roleChangedTemp = (userName: string, oldRole: string, newRole: string) => `
<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><title>Role Updated - Slingvo</title>
<style>body{font-family:Arial,sans-serif;line-height:1.6;color:#333;max-width:600px;margin:0 auto;padding:20px;background:#f4f4f4}.container{background:#fff;padding:30px;border-radius:10px;box-shadow:0 2px 10px rgba(0,0,0,.1)}.logo{font-size:24px;font-weight:bold;color:#2c3e50;text-align:center;margin-bottom:30px}.info{background:#f8f9fa;border:2px dashed #007bff;padding:20px;border-radius:8px;margin:20px 0}.footer{text-align:center;margin-top:30px;color:#666;font-size:14px}</style>
</head><body><div class="container">
<div class="logo">Slingvo</div>
<h2 style="color:#2c3e50">Your role has been updated</h2>
<p>Hi ${userName},</p>
<p>Your role in Slingvo has been changed.</p>
<div class="info">
  <p style="margin:0"><strong>Previous role:</strong> ${oldRole}</p>
  <p style="margin:8px 0 0"><strong>New role:</strong> ${newRole}</p>
</div>
<div class="footer"><p>© 2026 Slingvo. All rights reserved.</p></div>
</div></body></html>`

export const workspaceCreatedTemp = (ownerName: string, adminEmail: string, adminName: string) => `
<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><title>New Workspace - Slingvo</title>
<style>body{font-family:Arial,sans-serif;line-height:1.6;color:#333;max-width:600px;margin:0 auto;padding:20px;background:#f4f4f4}.container{background:#fff;padding:30px;border-radius:10px;box-shadow:0 2px 10px rgba(0,0,0,.1)}.logo{font-size:24px;font-weight:bold;color:#2c3e50;text-align:center;margin-bottom:30px}.info{background:#f8f9fa;border:2px dashed #28a745;padding:20px;border-radius:8px;margin:20px 0}.footer{text-align:center;margin-top:30px;color:#666;font-size:14px}</style>
</head><body><div class="container">
<div class="logo">Slingvo</div>
<h2 style="color:#2c3e50">New workspace created</h2>
<p>Hi ${ownerName},</p>
<p>A new customer workspace has been provisioned on Slingvo.</p>
<div class="info">
  <p style="margin:0"><strong>Name:</strong> ${adminName}</p>
  <p style="margin:8px 0 0"><strong>Email:</strong> ${adminEmail}</p>
</div>
<div class="footer"><p>© 2026 Slingvo. All rights reserved.</p></div>
</div></body></html>`

export const inactivityNudgeTemp = (fullName: string, loginUrl: string) => `
<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><title>We miss you - Slingvo</title>
<style>body{font-family:Arial,sans-serif;line-height:1.6;color:#333;max-width:600px;margin:0 auto;padding:20px;background:#f4f4f4}.container{background:#fff;padding:30px;border-radius:10px;box-shadow:0 2px 10px rgba(0,0,0,.1)}.logo{font-size:24px;font-weight:bold;color:#2c3e50;text-align:center;margin-bottom:30px}.footer{text-align:center;margin-top:30px;color:#666;font-size:14px}.button{display:inline-block;background:#FFCA06;color:#1a1a1a;padding:14px 32px;border-radius:8px;text-decoration:none;font-size:16px;font-weight:bold}</style>
</head><body><div class="container">
<div class="logo">Slingvo</div>
<h2 style="color:#2c3e50">We haven't seen you in a while</h2>
<p>Hi ${fullName},</p>
<p>It's been a few days since you last logged in to Slingvo. Your leads and team are waiting — jump back in whenever you're ready.</p>
<div style="text-align:center;margin:30px 0"><a href="${loginUrl}" class="button">Log back in</a></div>
<div class="footer"><p>© 2026 Slingvo. All rights reserved.</p></div>
</div></body></html>`

export const subscribeReminderTemp = (fullName: string, subscribeUrl: string) => `
<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><title>Complete your setup - Slingvo</title>
<style>body{font-family:Arial,sans-serif;line-height:1.6;color:#333;max-width:600px;margin:0 auto;padding:20px;background:#f4f4f4}.container{background:#fff;padding:30px;border-radius:10px;box-shadow:0 2px 10px rgba(0,0,0,.1)}.logo{font-size:24px;font-weight:bold;color:#2c3e50;text-align:center;margin-bottom:30px}.footer{text-align:center;margin-top:30px;color:#666;font-size:14px}.button{display:inline-block;background:#FFCA06;color:#1a1a1a;padding:14px 32px;border-radius:8px;text-decoration:none;font-size:16px;font-weight:bold}</style>
</head><body><div class="container">
<div class="logo">Slingvo</div>
<h2 style="color:#2c3e50">Your account is ready — activate it now</h2>
<p>Hi ${fullName},</p>
<p>Your Slingvo account is set up, but you haven't started your subscription yet. Activate your plan to unlock your dialer, contacts, and team tools.</p>
<div style="text-align:center;margin:30px 0"><a href="${subscribeUrl}" class="button">Activate my plan</a></div>
<div class="footer"><p>© 2026 Slingvo. All rights reserved.</p></div>
</div></body></html>`

export const reactivationTemp = (fullName: string, resubscribeUrl: string) => `
<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><title>Come back to Slingvo</title>
<style>body{font-family:Arial,sans-serif;line-height:1.6;color:#333;max-width:600px;margin:0 auto;padding:20px;background:#f4f4f4}.container{background:#fff;padding:30px;border-radius:10px;box-shadow:0 2px 10px rgba(0,0,0,.1)}.logo{font-size:24px;font-weight:bold;color:#2c3e50;text-align:center;margin-bottom:30px}.footer{text-align:center;margin-top:30px;color:#666;font-size:14px}.button{display:inline-block;background:#FFCA06;color:#1a1a1a;padding:14px 32px;border-radius:8px;text-decoration:none;font-size:16px;font-weight:bold}</style>
</head><body><div class="container">
<div class="logo">Slingvo</div>
<h2 style="color:#2c3e50">Your Slingvo access has ended — come back anytime</h2>
<p>Hi ${fullName},</p>
<p>Your Slingvo subscription is no longer active. Resubscribe to regain access to your dialer, contacts, and all your team's data.</p>
<div style="text-align:center;margin:30px 0"><a href="${resubscribeUrl}" class="button">Resubscribe now</a></div>
<div class="footer"><p>© 2026 Slingvo. All rights reserved.</p></div>
</div></body></html>`

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
        <div class="header"><div class="logo">Slingvo</div></div>
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
        <div class="header"><div class="logo">Slingvo</div></div>
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
        <div class="header"><div class="logo">Slingvo</div></div>
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
        <div class="header"><div class="logo">Slingvo</div></div>
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
        <div class="header"><div class="logo">Slingvo</div></div>
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
        <div class="header"><div class="logo">Slingvo</div></div>
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
        <div class="header"><div class="logo">Slingvo</div></div>
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
        <div class="header"><div class="logo">Slingvo</div></div>
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
        <div class="header"><div class="logo">Slingvo</div></div>
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
        <div class="header"><div class="logo">Slingvo</div></div>
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
</body>
</html>
`

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
        <div class="header"><div class="logo">Slingvo</div></div>
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
</body>
</html>
`

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