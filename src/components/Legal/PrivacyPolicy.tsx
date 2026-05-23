import LegalPage from './LegalPage'

export default function PrivacyPolicy() {
  return (
    <LegalPage title="Privacy Policy">
      <p>Sparrow ("we", "us", or "our") operates as an AI-powered cold email automation tool. This Privacy Policy explains how we collect, use, and protect your information.</p>
      <h2 className="font-display text-base font-semibold text-dark">Information We Collect</h2>
      <p>We collect information you provide directly, including your name, email address, and workspace configuration when you create an account. We also collect information about leads and contacts you add or discover through the platform.</p>
      <h2 className="font-display text-base font-semibold text-dark">How We Use Your Information</h2>
      <p>We use your information to provide and improve the Sparrow service, generate email drafts using AI, and send campaigns on your behalf. We do not sell your personal information to third parties.</p>
      <h2 className="font-display text-base font-semibold text-dark">Google OAuth</h2>
      <p>If you sign in with Google, we receive your name and email address from Google. We use this solely to authenticate your account. We do not access your Gmail, contacts, or any other Google data beyond what is required for authentication.</p>
      <h2 className="font-display text-base font-semibold text-dark">Data Retention</h2>
      <p>We retain your account data for as long as your account is active. You may request deletion of your data at any time by contacting us.</p>
      <h2 className="font-display text-base font-semibold text-dark">Contact</h2>
      <p>For questions about this policy, contact us at <a href="mailto:charlie.l.xue@gmail.com" className="text-primary underline underline-offset-2">charlie.l.xue@gmail.com</a>.</p>
    </LegalPage>
  )
}
