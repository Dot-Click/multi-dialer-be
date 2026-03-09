/**
 * Generates a secure random password.
 * Length: 8-15 characters.
 * Includes at least: 1 uppercase, 1 lowercase, 1 number, and 1 special character.
 */
export const generateSecurePassword = (): string => {
    const length = Math.floor(Math.random() * (15 - 8 + 1)) + 8; // Random length between 8 and 15
    const charset = {
        upper: "ABCDEFGHIJKLMNOPQRSTUVWXYZ",
        lower: "abcdefghijklmnopqrstuvwxyz",
        number: "0123456789",
        special: "!@#$%^&*"
    };

    // Ensure at least one of each character type is included
    let password = [
        charset.upper[Math.floor(Math.random() * charset.upper.length)],
        charset.lower[Math.floor(Math.random() * charset.lower.length)],
        charset.number[Math.floor(Math.random() * charset.number.length)],
        charset.special[Math.floor(Math.random() * charset.special.length)]
    ];

    // Fill the remaining length with random characters from all sets
    const allChars = Object.values(charset).join("");
    for (let i = password.length; i < length; i++) {
        password.push(allChars[Math.floor(Math.random() * allChars.length)]);
    }

    // Shuffle the password array using Fisher-Yates shuffle for better randomness
    for (let i = password.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [password[i], password[j]] = [password[j], password[i]];
    }

    return password.join("");
};
