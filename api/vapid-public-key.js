module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'public, max-age=3600');
  const key = process.env.VAPID_PUBLIC_KEY || '';
  res.status(200).json({ key });
};
