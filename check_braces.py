import sys

def check_balance(filename):
    with open(filename, 'r') as f:
        content = f.read()
    
    stack = []
    lines = content.split('\n')
    
    in_single_quote = False
    in_double_quote = False
    in_template_literal = False
    in_comment_single = False
    in_comment_multi = False
    
    for line_num, line in enumerate(lines, 1):
        i = 0
        while i < len(line):
            char = line[i]
            
            # Handle comments
            if not in_comment_multi and not in_comment_single:
                if line[i:i+2] == '//' and not (in_single_quote or in_double_quote or in_template_literal):
                    break # Rest of line is a comment
                if line[i:i+2] == '/*' and not (in_single_quote or in_double_quote or in_template_literal):
                    in_comment_multi = True
                    i += 2
                    continue
            
            if in_comment_multi:
                if line[i:i+2] == '*/':
                    in_comment_multi = False
                    i += 2
                    continue
                i += 1
                continue
                
            # Handle strings
            if char == "'" and not in_double_quote and not in_template_literal:
                if i == 0 or line[i-1] != '\\':
                    in_single_quote = not in_single_quote
            elif char == '"' and not in_single_quote and not in_template_literal:
                if i == 0 or line[i-1] != '\\':
                    in_double_quote = not in_double_quote
            elif char == '`' and not in_single_quote and not in_double_quote:
                if i == 0 or line[i-1] != '\\':
                    in_template_literal = not in_template_literal
            
            if not in_single_quote and not in_double_quote and not in_template_literal:
                if char in '{[(':
                    stack.append((char, line_num))
                elif char in '}])':
                    if not stack:
                        print(f"Extra closing '{char}' at line {line_num}")
                        return
                    top_char, top_line = stack.pop()
                    if (char == '}' and top_char != '{') or \
                       (char == ']' and top_char != '[') or \
                       (char == ')' and top_char != '('):
                        print(f"Mismatch: '{top_char}' at line {top_line} closed by '{char}' at line {line_num}")
                        return
            
            i += 1
            
    if stack:
        for char, line_num in stack:
            print(f"Unclosed '{char}' at line {line_num}")
    else:
        print("Braces are balanced!")

if __name__ == "__main__":
    check_balance(sys.argv[1])
