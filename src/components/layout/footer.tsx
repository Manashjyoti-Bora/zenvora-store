import Link from 'next/link';
import { getSettings } from '@/lib/settings';

export async function Footer() {
  const settings = await getSettings();
  const year = new Date().getFullYear();

  return (
    <footer className="mt-12 border-t border-gray-200 bg-white">
      <div className="container-store grid grid-cols-2 gap-8 py-10 md:grid-cols-4">
        <div className="col-span-2 md:col-span-1">
          <p className="text-base font-bold text-gray-900">{settings.storeName}</p>
          {settings.storeTagline && (
            <p className="mt-1 text-sm text-gray-500">{settings.storeTagline}</p>
          )}
          <p className="mt-3 text-xs leading-relaxed text-gray-500">
            {settings.business.legalName && (
              <>
                {settings.business.legalName}
                <br />
              </>
            )}
            {[
              settings.business.addressLine,
              settings.business.city,
              settings.business.state,
              settings.business.postalCode,
            ]
              .filter(Boolean)
              .join(', ') || 'Business address to be published by the store owner.'}
            {settings.business.gstin && (
              <>
                <br />
                GSTIN: {settings.business.gstin}
              </>
            )}
          </p>
        </div>
        <nav aria-label="Shop">
          <h3 className="text-sm font-semibold text-gray-900">Shop</h3>
          <ul className="mt-3 space-y-2 text-sm text-gray-600">
            <li>
              <Link href="/shop" className="hover:text-brand-700">
                All products
              </Link>
            </li>
            <li>
              <Link href="/shop?sort=newest" className="hover:text-brand-700">
                New arrivals
              </Link>
            </li>
            <li>
              <Link href="/track" className="hover:text-brand-700">
                Track your order
              </Link>
            </li>
            <li>
              <Link href="/cart" className="hover:text-brand-700">
                Cart
              </Link>
            </li>
          </ul>
        </nav>
        <nav aria-label="Help">
          <h3 className="text-sm font-semibold text-gray-900">Help</h3>
          <ul className="mt-3 space-y-2 text-sm text-gray-600">
            <li>
              <Link href="/faq" className="hover:text-brand-700">
                FAQ
              </Link>
            </li>
            <li>
              <Link href="/contact" className="hover:text-brand-700">
                Contact us
              </Link>
            </li>
            <li>
              <Link href="/policies/shipping" className="hover:text-brand-700">
                Shipping policy
              </Link>
            </li>
            <li>
              <Link href="/policies/returns" className="hover:text-brand-700">
                Returns &amp; refunds
              </Link>
            </li>
          </ul>
        </nav>
        <nav aria-label="Legal and account">
          <h3 className="text-sm font-semibold text-gray-900">Legal &amp; account</h3>
          <ul className="mt-3 space-y-2 text-sm text-gray-600">
            <li>
              <Link href="/policies/privacy" className="hover:text-brand-700">
                Privacy policy
              </Link>
            </li>
            <li>
              <Link href="/policies/terms" className="hover:text-brand-700">
                Terms &amp; conditions
              </Link>
            </li>
            <li>
              <Link href="/auth/login" className="hover:text-brand-700">
                Log in
              </Link>
            </li>
            <li>
              <Link href="/auth/register" className="hover:text-brand-700">
                Create account
              </Link>
            </li>
          </ul>
          <div className="mt-4 text-xs text-gray-500">
            <p>
              Support:{' '}
              <a href={`mailto:${settings.supportEmail}`} className="hover:text-brand-700">
                {settings.supportEmail}
              </a>
            </p>
            {settings.supportPhone && <p>Phone: {settings.supportPhone}</p>}
          </div>
        </nav>
      </div>
      <div className="border-t border-gray-100 py-4">
        <div className="container-store flex flex-col items-center justify-between gap-2 text-xs text-gray-400 sm:flex-row">
          <p>
            © {year} {settings.storeName}. All rights reserved.
          </p>
          <p>Prices in INR (₹), inclusive of applicable taxes where configured.</p>
        </div>
      </div>
    </footer>
  );
}
