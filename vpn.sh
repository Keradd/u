#!/bin/bash

WG_INTERFACE="wg0"
CLIENT_CONF="client.conf"

echo "Mematikan WireGuard interface dan service..."
systemctl stop wg-quick@${WG_INTERFACE}
systemctl disable wg-quick@${WG_INTERFACE}

echo "Menghapus konfigurasi WireGuard..."
rm -f /etc/wireguard/${WG_INTERFACE}.conf
rm -rf /etc/wireguard/keys
rm -f ~/${CLIENT_CONF}

echo "Menghapus paket WireGuard dan dependencies jika tidak dibutuhkan..."
apt remove --purge -y wireguard qrencode ip6tables curl openssh-server

echo "Membersihkan paket yang sudah tidak dibutuhkan..."
apt autoremove -y

# Menonaktifkan IPv6 forwarding (jika ingin)
if grep -q "^net.ipv6.conf.all.forwarding=1" /etc/sysctl.conf; then
  echo "Menonaktifkan IPv6 forwarding..."
  sed -i '/^net.ipv6.conf.all.forwarding=1/d' /etc/sysctl.conf
  sysctl -w net.ipv6.conf.all.forwarding=0
fi

echo "Uninstall WireGuard IPv6-only VPN selesai bersih."
