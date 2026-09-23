const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');
const { generateToken, verifyToken } = require('../utils/tokenUtils');

const prisma = new PrismaClient();

const register = async (req, res) => {
  try {
    const { email, username, password, fullName } = req.body;

    const existingUser = await prisma.user.findFirst({
      where: { OR: [{ email }, { username }] },
    });

    if (existingUser) {
      return res.status(400).json({ error: 'Email or username already exists' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const user = await prisma.user.create({
      data: {
        email,
        username,
        password: hashedPassword,
        fullName,
      },
    });

    const accessToken = generateToken(user.id);
    const refreshToken = generateToken(user.id, '30d');

    res.status(201).json({
      message: 'User registered successfully',
      user: {
        id: user.id,
        email: user.email,
        username: user.username,
        fullName: user.fullName,
      },
      accessToken,
      refreshToken,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

const login = async (req, res) => {
  try {
    const { email, password } = req.body;

    const user = await prisma.user.findUnique({ where: { email } });

    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    if (user.status === 'SUSPENDED' || user.status === 'DELETED') {
      return res.status(403).json({ error: 'Account is not active' });
    }

    const isPasswordValid = await bcrypt.compare(password, user.password);

    if (!isPasswordValid) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const accessToken = generateToken(user.id);
    const refreshToken = generateToken(user.id, '30d');

    res.json({
      message: 'Login successful',
      user: {
        id: user.id,
        email: user.email,
        username: user.username,
        fullName: user.fullName,
      },
      accessToken,
      refreshToken,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

const getProfile = async (req, res) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.userId },
      select: {
        id: true,
        email: true,
        username: true,
        fullName: true,
        phone: true,
        avatar: true,
        bio: true,
        location: true,
        role: true,
        status: true,
        avgRating: true,
        totalRatings: true,
      },
    });

    res.json({ user });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

const refreshToken = async (req, res) => {
  try {
    const { refreshToken: token } = req.body;

    const decoded = verifyToken(token);

    if (!decoded) {
      return res.status(401).json({ error: 'Invalid refresh token' });
    }

    const user = await prisma.user.findUnique({
      where: { id: decoded.userId },
    });

    if (!user) {
      return res.status(401).json({ error: 'User not found' });
    }

    const accessToken = generateToken(user.id);

    res.json({ accessToken });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

const sendVerificationEmail = async (req, res) => {
  try {
    const { email } = req.body;

    const user = await prisma.user.findUnique({ where: { email } });

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const code = Math.floor(100000 + Math.random() * 900000).toString();

    await prisma.verification.upsert({
      where: { userId_type: { userId: user.id, type: 'EMAIL' } },
      update: { code, expiresAt: new Date(Date.now() + 10 * 60 * 1000) },
      create: {
        userId: user.id,
        type: 'EMAIL',
        value: email,
        code,
        expiresAt: new Date(Date.now() + 10 * 60 * 1000),
      },
    });

    res.json({ message: 'Verification code sent' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

const confirmEmail = async (req, res) => {
  try {
    const { email, code } = req.body;

    const user = await prisma.user.findUnique({ where: { email } });

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const verification = await prisma.verification.findUnique({
      where: { userId_type: { userId: user.id, type: 'EMAIL' } },
    });

    if (!verification) {
      return res.status(404).json({ error: 'Verification not found' });
    }

    if (verification.code !== code) {
      return res.status(400).json({ error: 'Invalid code' });
    }

    if (new Date() > verification.expiresAt) {
      return res.status(400).json({ error: 'Code expired' });
    }

    await prisma.user.update({
      where: { id: user.id },
      data: { verifiedEmail: true },
    });

    await prisma.verification.update({
      where: { id: verification.id },
      data: { verified: true },
    });

    res.json({ message: 'Email verified successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

const logout = (req, res) => {
  res.json({ message: 'Logout successful' });
};

module.exports = {
  register,
  login,
  getProfile,
  refreshToken,
  sendVerificationEmail,
  confirmEmail,
  logout,
};