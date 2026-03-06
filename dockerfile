# Use the official Ubuntu base image
FROM ubuntu:20.04

# Set environment variables to non-interactive
ENV DEBIAN_FRONTEND=noninteractive \
    PUPPETEER_SKIP_DOWNLOAD=1 \
    PUPPETEER_DISABLE_HEADLESS_WARNING=true

# Install required packages and create user azuser
RUN apt-get update && apt-get install -y \
    sudo \
    curl \
    gnupg2 \
    openssh-server \
    vim \
    nano \
    cron \
    apt-utils \
    python3 \
    python3-pip 

RUN useradd -m -s /bin/bash azuser && echo "azuser:azuserpassword" | chpasswd && adduser azuser sudo \
    && echo "azuser ALL=(ALL) NOPASSWD:ALL" >> /etc/sudoers \
    && mkdir /var/run/sshd

# Install Node.js (using NodeSource)
RUN curl -fsSL https://deb.nodesource.com/setup_21.x | sudo -E bash - && \
    sudo apt-get install -y nodejs


# Install Google Chrome
RUN sudo apt install curl gnupg -y && \
    curl --location --silent https://dl-ssl.google.com/linux/linux_signing_key.pub | sudo apt-key add - && \
    sudo sh -c 'echo "deb [arch=amd64] http://dl.google.com/linux/chrome/deb/ stable main" >> /etc/apt/sources.list.d/google.list' && \
    sudo apt update && sudo apt install -y google-chrome-stable --no-install-recommends && \
    sudo rm -rf /var/lib/apt/lists/*



# Switch to user azuser
USER azuser
WORKDIR /home/azuser


# Copy the Node.js script and install necessary npm packages
COPY --chown=azuser:azuser . .
RUN npm install puppeteer-core dotenv otpauth axios


# Set up cron job
RUN (crontab -l 2>/dev/null; echo "*/5 * * * * bash -l /home/azuser/scrape.sh ") | crontab -


# Switch back to root user to configure SSH
USER root

# Configure SSH

RUN sed -i 's/#PermitRootLogin prohibit-password/PermitRootLogin yes/' /etc/ssh/sshd_config && \
    echo 'PermitRootLogin yes' >> /etc/ssh/sshd_config && \
    sed -i 's/#PasswordAuthentication yes/PasswordAuthentication yes/' /etc/ssh/sshd_config


# Expose ports
EXPOSE 22

# Start SSH and cron service, 
CMD service cron start && /usr/sbin/sshd -D
