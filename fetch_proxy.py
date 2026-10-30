"""
Hardened Raw Fetch Proxy for Commonplace (PS-003)
Implements socket-level IP address pinning, comprehensive IPv4/IPv6 CIDR validation,
DNS rebinding immunity, redirect re-validation, and response size limits.
"""

import ipaddress
import socket
import ssl
import urllib.parse
from typing import Dict, Any, List, Tuple, Optional

# Prohibited network ranges:
# RFC 1918 (Private), RFC 3927 (Link-Local), Loopback, Carrier Grade NAT, Cloud Metadata
PROHIBITED_NETWORKS = [
    ipaddress.ip_network("0.0.0.0/8"),          # Current network (only valid as source)
    ipaddress.ip_network("10.0.0.0/8"),         # RFC 1918
    ipaddress.ip_network("100.64.0.0/10"),      # RFC 6598 Shared Address Space / CGNAT
    ipaddress.ip_network("127.0.0.0/8"),        # Loopback
    ipaddress.ip_network("169.254.0.0/16"),     # RFC 3927 Link-Local / Cloud Metadata (169.254.169.254)
    ipaddress.ip_network("172.16.0.0/12"),      # RFC 1918
    ipaddress.ip_network("192.0.0.0/24"),       # IETF Protocol Assignments
    ipaddress.ip_network("192.0.2.0/24"),       # TEST-NET-1
    ipaddress.ip_network("192.88.99.0/24"),     # 6to4 Relay Anycast
    ipaddress.ip_network("192.168.0.0/16"),     # RFC 1918
    ipaddress.ip_network("198.18.0.0/15"),      # Network Interconnect Benchmarking
    ipaddress.ip_network("198.51.100.0/24"),    # TEST-NET-2
    ipaddress.ip_network("203.0.113.0/24"),     # TEST-NET-3
    ipaddress.ip_network("224.0.0.0/4"),        # Multicast
    ipaddress.ip_network("240.0.0.0/4"),        # Reserved / Future use
    ipaddress.ip_network("255.255.255.255/32"), # Broadcast
    # IPv6 Prohibited
    ipaddress.ip_network("::/128"),             # Unspecified
    ipaddress.ip_network("::1/128"),            # Loopback
    ipaddress.ip_network("::ffff:0:0/96"),      # IPv4-mapped IPv6 (must be checked as IPv4)
    ipaddress.ip_network("64:ff9b::/96"),       # IPv4/IPv6 translation
    ipaddress.ip_network("100::/64"),           # Discard prefix
    ipaddress.ip_network("2001::/23"),          # IETF Protocol Assignments
    ipaddress.ip_network("2001:db8::/32"),      # Documentation
    ipaddress.ip_network("2002::/16"),          # 6to4
    ipaddress.ip_network("fc00::/7"),           # Unique Local Address (ULA)
    ipaddress.ip_network("fe80::/10"),          # Link-Local
    ipaddress.ip_network("ff00::/8"),           # Multicast
]

MAX_REDIRECTS = 3
MAX_RESPONSE_SIZE = 5 * 1024 * 1024  # 5 MB
SOCKET_TIMEOUT = 8.0                 # 8 seconds


class SecurityException(Exception):
    """Raised when an address violates the SSRF security policy."""
    pass


def validate_ip_address(ip: ipaddress.IPv4Address | ipaddress.IPv6Address) -> None:
    """
    Validates that an IP address does not fall into any prohibited, private,
    loopback, link-local, or cloud metadata ranges.
    """
    # Unpack IPv4-mapped IPv6 addresses (e.g. ::ffff:127.0.0.1)
    if isinstance(ip, ipaddress.IPv6Address) and ip.ipv4_mapped:
        ip = ip.ipv4_mapped

    if ip.is_loopback:
        raise SecurityException(f"Destination IP {ip} is a loopback address.")
    if ip.is_link_local:
        raise SecurityException(f"Destination IP {ip} is a link-local / cloud metadata address.")
    if ip.is_private:
        raise SecurityException(f"Destination IP {ip} is a private RFC1918/ULA address.")
    if ip.is_multicast:
        raise SecurityException(f"Destination IP {ip} is a multicast address.")
    if ip.is_reserved:
        raise SecurityException(f"Destination IP {ip} is a reserved address.")
    if ip.is_unspecified:
        raise SecurityException(f"Destination IP {ip} is unspecified.")

    for net in PROHIBITED_NETWORKS:
        if ip in net:
            raise SecurityException(f"Destination IP {ip} belongs to prohibited network {net}.")


def resolve_and_validate_host(hostname: str) -> Tuple[str, int]:
    """
    Resolves hostname to IP addresses and ensures EVERY resolved IP is public and safe.
    Returns (validated_ip_string, address_family).
    """
    try:
        addrinfo = socket.getaddrinfo(hostname, None, socket.AF_UNSPEC, socket.SOCK_STREAM)
    except socket.gaierror as e:
        raise SecurityException(f"DNS resolution failed for {hostname}: {e}")

    if not addrinfo:
        raise SecurityException(f"No IP addresses resolved for {hostname}")

    validated_ips = []
    for family, socktype, proto, canonname, sockaddr in addrinfo:
        ip_str = sockaddr[0]
        try:
            ip_obj = ipaddress.ip_address(ip_str)
            validate_ip_address(ip_obj)
            validated_ips.append((ip_str, family))
        except (ValueError, SecurityException) as e:
            # If any resolved IP is prohibited, fail closed to prevent rebinding / multi-A evasion
            raise SecurityException(f"Host '{hostname}' resolved to prohibited IP '{ip_str}': {e}")

    if not validated_ips:
        raise SecurityException(f"No safe IP addresses found for {hostname}")

    # Return the first validated safe IP and its address family
    return validated_ips[0]


def safe_fetch_url(url: str) -> Dict[str, Any]:
    """
    Performs a hardened HTTP/HTTPS GET request with:
    - URL parsing & validation
    - Socket connection pinning directly to validated IP (prevents DNS rebinding)
    - TLS hostname verification using SNI
    - Redirect validation & hop tracking (up to MAX_REDIRECTS)
    - 5 MB maximum response size limit
    - 8-second timeout
    Returns a dict with raw bytes, status_code, content_type, final_url, redirect_hops.
    """
    current_url = url
    redirect_hops: List[Dict[str, Any]] = []

    for hop in range(MAX_REDIRECTS + 1):
        parsed = urllib.parse.urlparse(current_url)

        # 1. Reject invalid schemes
        if parsed.scheme not in ('http', 'https'):
            raise SecurityException(f"Unsupported scheme '{parsed.scheme}'. Only http and https allowed.")

        # 2. Reject credentials in URL
        if parsed.username or parsed.password:
            raise SecurityException("URL user credentials (user:pass) are prohibited.")

        # 3. Reject unsupported ports (only standard 80 and 443 allowed)
        port = parsed.port
        if port is None:
            port = 443 if parsed.scheme == 'https' else 80
        if port not in (80, 443):
            raise SecurityException(f"Port {port} is not permitted. Only standard ports 80 and 443 are allowed.")

        hostname = parsed.hostname
        if not hostname:
            raise SecurityException("Missing hostname in target URL.")

        # 4. Resolve destination and pin IP address
        validated_ip, family = resolve_and_validate_host(hostname)

        # 5. Build raw HTTP request
        path = parsed.path if parsed.path else "/"
        if parsed.query:
            path += f"?{parsed.query}"

        # Standard minimal headers
        req_headers = [
            f"GET {path} HTTP/1.1",
            f"Host: {hostname}",
            "User-Agent: Commonplace-Reader/1.0 (+https://commonplace.local; privacy-preserving-rss)",
            "Accept: application/rss+xml, application/atom+xml, application/xml, text/xml, text/html, */*",
            "Accept-Encoding: identity",  # Request identity to accurately enforce 5MB decoded limit
            "Connection: close",
            "",
            ""
        ]
        request_data = "\r\n".join(req_headers).encode("latin-1")

        # 6. Establish socket connected directly to validated_ip
        raw_sock = socket.socket(family, socket.SOCK_STREAM)
        raw_sock.settimeout(SOCKET_TIMEOUT)

        sock = raw_sock
        try:
            raw_sock.connect((validated_ip, port))

            # If HTTPS, wrap socket with TLS while preserving SNI hostname verification
            if parsed.scheme == 'https':
                context = ssl.create_default_context()
                sock = context.wrap_socket(raw_sock, server_hostname=hostname)

            # Send request
            sock.sendall(request_data)

            # 7. Read response headers and body under size budget
            response_chunks = []
            total_bytes = 0
            header_data = b""
            body_start_idx = -1

            while True:
                chunk = sock.recv(65536)
                if not chunk:
                    break

                total_bytes += len(chunk)
                if total_bytes > MAX_RESPONSE_SIZE:
                    raise SecurityException(f"Response exceeded 5 MB size limit ({total_bytes} bytes).")

                if body_start_idx == -1:
                    header_data += chunk
                    sep = header_data.find(b"\r\n\r\n")
                    if sep != -1:
                        body_start_idx = sep + 4
                        response_chunks.append(header_data[body_start_idx:])
                else:
                    response_chunks.append(chunk)

            if body_start_idx == -1:
                raise ValueError("Incomplete HTTP response: headers not terminated.")

            headers_raw = header_data[:body_start_idx - 4].decode("iso-8859-1", errors="replace")
            body_bytes = b"".join(response_chunks)

        finally:
            try:
                sock.close()
            except Exception:
                pass

        # 8. Parse status line and headers
        header_lines = headers_raw.split("\r\n")
        status_line = header_lines[0]
        status_parts = status_line.split(" ", 2)
        if len(status_parts) < 2:
            raise ValueError(f"Malformed HTTP status line: '{status_line}'")

        try:
            status_code = int(status_parts[1])
        except ValueError:
            raise ValueError(f"Non-integer status code in: '{status_line}'")

        headers_dict: Dict[str, str] = {}
        for line in header_lines[1:]:
            if ":" in line:
                k, v = line.split(":", 1)
                headers_dict[k.strip().lower()] = v.strip()

        content_type = headers_dict.get("content-type", "application/octet-stream")

        # 9. Handle redirects
        if status_code in (301, 302, 303, 307, 308) and "location" in headers_dict:
            redirect_target = headers_dict["location"]
            # Resolve relative redirect URLs against current URL
            next_url = urllib.parse.urljoin(current_url, redirect_target)
            redirect_hops.append({
                "from_url": current_url,
                "to_url": next_url,
                "status_code": status_code,
                "validated_ip": validated_ip
            })

            if hop == MAX_REDIRECTS:
                raise SecurityException(f"Exceeded maximum redirect limit of {MAX_REDIRECTS} hops.")

            current_url = next_url
            continue  # Follow redirect with new loop iteration

        # Non-redirect final response
        return {
            "status_code": status_code,
            "content_type": content_type,
            "body": body_bytes,
            "final_url": current_url,
            "redirect_hops": redirect_hops,
            "validated_ip": validated_ip,
        }

    raise SecurityException("Redirect processing failed unexpectedly.")
