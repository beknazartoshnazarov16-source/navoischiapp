import { User } from '../types';

/**
 * Xodimning PIN kodini aniqlash.
 * Agar xodim o'z shaxsiy PIN kodini kiritmagan bo'lsa,
 * standart holatda uning telefon raqamining oxirgi 4 ta raqami PIN kod hisoblanadi.
 */
export function getUserPin(user: User): string {
  if (user.pin && user.pin.trim().length >= 4) {
    return user.pin.trim();
  }
  const digits = (user.phone || '').replace(/\D/g, '');
  if (digits.length >= 4) {
    return digits.slice(-4);
  }
  return '1234';
}

/**
 * Xodim PIN kodini tekshirish
 */
export function verifyWorkerPin(user: User, inputPin: string): boolean {
  const cleanInput = inputPin.trim();
  const correctPin = getUserPin(user);
  return cleanInput === correctPin;
}

/**
 * Telefon raqami bo'yicha foydalanuvchini topish (raqamlarni tozalab solishtirish)
 */
export function findUserByPhone(users: User[], phoneInput: string): User | undefined {
  const inputDigits = phoneInput.replace(/\D/g, '');
  if (!inputDigits || inputDigits.length < 4) return undefined;

  return users.find((u) => {
    const userDigits = (u.phone || '').replace(/\D/g, '');
    if (!userDigits) return false;
    // To'liq mos kelish yoki oxirgi 9 ta raqam mos kelishi
    return (
      userDigits === inputDigits ||
      (userDigits.length >= 9 &&
        inputDigits.length >= 9 &&
        userDigits.slice(-9) === inputDigits.slice(-9))
    );
  });
}
