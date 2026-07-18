#!/usr/bin/env node

/**
 * Simplified Wave Agent SDK Streaming Demo
 * 
 * Shows that onMessagesChange contains all streaming data, 
 * making other callbacks potentially redundant.
 */

import { Agent } from 'wave-agent-sdk';

console.log('🌊 Simplified Streaming Demo - onMessagesChange Only');
console.log('=====================================================\n');

async function demonstrateSimplifiedStreaming() {
    let agent;
    let messageCount = 0;
    
    try {
        console.log('🤖 Creating Agent with minimal callbacks...');
        
        // Only use onMessagesChange - it has everything we need!
        const callbacks = {
            onMessagesChange: (messages) => {
                messageCount++;
                console.log(`\n💬 onMessagesChange #${messageCount}: ${messages.length} messages`);
                
                messages.forEach((msg, i) => {
                    const content = getMessageContent(msg);
                    const isComplete = !isMessageStreaming(msg);
                    
                    console.log(`   [${i}] ${msg.role}: "${content.slice(0, 60)}${content.length > 60 ? '...' : ''}"`);
                    console.log(`       📊 Length: ${content.length} chars, Complete: ${isComplete}`);
                });
            }
        };
        
        agent = await Agent.create({
            callbacks,
            workdir: process.cwd(),
            model: 'gemini-2.5-flash'
        });
        
        console.log('✅ Agent created with only onMessagesChange callback!');
        console.log('\n' + '='.repeat(60));
        console.log('📤 Sending message: "hi"');
        console.log('='.repeat(60));
        
        await agent.sendMessage('ls');
        
        console.log('\n' + '='.repeat(60));
        console.log('✅ Streaming completed');
        console.log(`📊 Total onMessagesChange calls: ${messageCount}`);
        console.log('='.repeat(60));
        
    } catch (error) {
        console.error('❌ Error:', error);
    } finally {
        if (agent) {
            await agent.destroy();
            console.log('\n🧹 Agent cleaned up');
        }
    }
}

/**
 * Extract text content from message
 */
function getMessageContent(message) {
    if (!message.blocks) return '';
    return message.blocks
        .filter(block => block.type === 'text')
        .map(block => block.content)
        .join('\n');
}

/**
 * Check if message is still streaming (incomplete)
 * This is just a heuristic - in practice you might use other indicators
 */
function isMessageStreaming(message) {
    if (message.role !== 'assistant') return false;
    
    const content = getMessageContent(message);
    
    // Simple heuristic: very short content or ends abruptly might be streaming
    return content.length < 20 || !content.trim().match(/[.!?]$/);
}

function showSimplifiedApproach() {
    console.log('\n💡 Simplified React Approach:');
    console.log('━'.repeat(40));
    console.log('');
    console.log('🎯 SINGLE CALLBACK STRATEGY:');
    console.log('• Only use onMessagesChange(messages)');
    console.log('• It contains ALL data including streaming chunks');
    console.log('• Detect streaming vs complete based on message state');
    console.log('');
    console.log('📝 REACT IMPLEMENTATION:');
    console.log('```typescript');
    console.log('const [messages, setMessages] = useState([]);');
    console.log('');
    console.log('const callbacks = {');
    console.log('  onMessagesChange: (newMessages) => {');
    console.log('    setMessages(newMessages); // React re-renders automatically');
    console.log('  }');
    console.log('};');
    console.log('');
    console.log('// In component:');
    console.log('messages.map(msg => (');
    console.log('  <Message ');
    console.log('    key={msg.id} ');
    console.log('    content={extractContent(msg)}');
    console.log('    isStreaming={isLastMessage && !isComplete(msg)}');
    console.log('  />');
    console.log('))');
    console.log('```');
    console.log('');
    console.log('✨ BENEFITS:');
    console.log('• Much simpler - single source of truth');
    console.log('• No complex streaming state management');
    console.log('• React handles re-renders automatically');
    console.log('• Less prone to race conditions');
}

// Run the demo
demonstrateSimplifiedStreaming()
    .then(() => {
        showSimplifiedApproach();
        console.log('\n🎉 You\'re right! onMessagesChange has everything we need.');
    })
    .catch(error => {
        console.error('💥 Demo failed:', error);
        process.exit(1);
    });
